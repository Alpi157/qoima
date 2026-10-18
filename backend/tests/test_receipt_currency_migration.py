import os
import subprocess
import uuid

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from app.inventory.service import MovementIn, post_movements
from app.receipts.schemas import ReceiptCreate
from app.receipts.service import post_receipt
from tests.conftest import BACKEND_DIR, test_engine

PREVIOUS = "8a4d2b731025"
REVISION = "9b5e3c841026"


@pytest.fixture
def migration_case():
    schema = "receipt_currency_migration_" + uuid.uuid4().hex
    options = f"-csearch_path={schema},public"
    with test_engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(test_engine.url, connect_args={"options": options})
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE alembic_version (version_num varchar(32) PRIMARY KEY)"))

    def migrate(direction, revision, check=True):
        return subprocess.run(
            ["uv", "run", "alembic", direction, revision],
            cwd=BACKEND_DIR,
            env={
                **os.environ,
                "DATABASE_URL": test_engine.url.render_as_string(hide_password=False),
                "PGOPTIONS": options,
            },
            capture_output=True,
            text=True,
            check=check,
        )

    try:
        migrate("upgrade", PREVIOUS)
        request_id = uuid.uuid4()
        with engine.begin() as conn:
            user = conn.scalar(
                text(
                    "INSERT INTO users (username,password_hash,full_name) VALUES "
                    "('migration','test','Test') RETURNING id"
                )
            )
            product = conn.scalar(
                text(
                    "INSERT INTO products (article,article_norm,name) VALUES "
                    "('MIG','MIG','Migration') RETURNING id"
                )
            )
            for number in (1, 2, 3):
                receipt = conn.scalar(
                    text(
                        "INSERT INTO receipts "
                        "(number,request_id,created_by,status,cancelled_at,received_at) "
                        "VALUES "
                        "(:number,:request_id,:user,:status,:cancelled_at,"
                        "'2026-10-14T12:00:00Z') RETURNING id"
                    ),
                    {
                        "number": number,
                        "request_id": request_id if number == 1 else None,
                        "user": user,
                        "status": "cancelled" if number == 3 else "posted",
                        "cancelled_at": "2026-10-14T13:00:00Z" if number == 3 else None,
                    },
                )
                conn.execute(
                    text(
                        "INSERT INTO receipt_lines "
                        "(receipt_id,product_id,article,name,unit,qty,unit_cost) "
                        "VALUES (:receipt,:product,'MIG','Migration','шт',3,:cost)"
                    ),
                    {"receipt": receipt, "product": product, "cost": None if number == 2 else 101},
                )
            conn.execute(
                text("UPDATE document_counters SET last_number=3 WHERE doc_type='receipt'")
            )
        with Session(engine) as db:
            historical = db.execute(text("SELECT id,number FROM receipts ORDER BY number")).all()
            for receipt_id, number in historical:
                post_movements(
                    db,
                    [
                        MovementIn(
                            product,
                            3,
                            "receipt",
                            doc_type="receipt",
                            doc_id=receipt_id,
                            unit_cost=None if number == 2 else 101,
                        )
                    ],
                    user,
                )
            post_movements(
                db,
                [
                    MovementIn(
                        product,
                        -3,
                        "receipt_cancel",
                        doc_type="receipt",
                        doc_id=historical[-1].id,
                        unit_cost=101,
                    )
                ],
                user,
            )
            db.commit()
        yield engine, migrate, {"user": user, "product": product, "request_id": request_id}
    finally:
        engine.dispose()
        with test_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


def legacy_contents(conn):
    return {
        "headers": conn.execute(
            text(
                "SELECT id,number,request_id,status,cancelled_at,received_at FROM receipts "
                "ORDER BY id"
            )
        ).all(),
        "lines": conn.execute(
            text("SELECT id,receipt_id,product_id,qty,unit_cost FROM receipt_lines ORDER BY id")
        ).all(),
        "movements": conn.execute(text("SELECT * FROM stock_movements ORDER BY id")).all(),
        "balances": conn.execute(
            text("SELECT * FROM stock_balances ORDER BY product_id,warehouse_id")
        ).all(),
    }


def test_upgrade_legacy_and_safe_round_trip(migration_case):
    engine, migrate, _ = migration_case
    with engine.connect() as conn:
        before = legacy_contents(conn)
    for direction, revision in [
        ("upgrade", REVISION),
        ("downgrade", PREVIOUS),
        ("upgrade", REVISION),
    ]:
        migrate(direction, revision)
        with engine.connect() as conn:
            assert legacy_contents(conn) == before
            assert conn.scalar(text("SELECT version_num FROM alembic_version")) == revision
            if direction == "downgrade":
                assert "currency" not in {c["name"] for c in inspect(conn).get_columns("receipts")}
                continue
            assert (
                conn.execute(
                    text(
                        "SELECT "
                        "currency,exchange_rate,rate_date,rate_source,vat_payer_snapshot FROM "
                        "receipts ORDER BY id"
                    )
                ).all()
                == [("KZT", 1, None, None, False)] * 3
            )
            assert conn.execute(
                text(
                    "SELECT unit_price_minor,goods_total,expenses_total,unit_cost FROM "
                    "receipt_lines ORDER BY id"
                )
            ).all() == [(101, 303, 0, 101), (None, None, 0, None), (101, 303, 0, 101)]
            assert conn.scalar(text("SELECT is_vat_payer FROM business_settings")) is False
            assert conn.scalar(text("SELECT count(*) FROM receipt_expenses")) == 0
            assert conn.scalar(text("SELECT count(*) FROM receipt_expense_allocations")) == 0


def test_legacy_request_id_replays_after_upgrade(migration_case):
    from app.catalog.service import get_product

    engine, migrate, ids = migration_case
    migrate("upgrade", REVISION)
    with Session(engine) as db:
        result, created = post_receipt(
            db,
            ReceiptCreate(
                request_id=ids["request_id"],
                received_at="2026-10-14T12:00:00Z",
                lines=[{"product_id": ids["product"], "qty": 3, "unit_cost": 101}],
            ),
            ids["user"],
        )
        assert not created and result.number == 1
        assert result.goods_total == result.total_cost == 303
        product = get_product(db, ids["product"])
        assert (
            product.last_cost,
            product.last_purchase_currency,
            product.last_purchase_price_minor,
        ) == (101, "KZT", 101)
        assert db.scalar(text("SELECT count(*) FROM receipts")) == 3
        assert (
            db.scalar(text("SELECT last_number FROM document_counters WHERE doc_type='receipt'"))
            == 3
        )
        assert db.scalar(text("SELECT count(*) FROM stock_movements")) == 4


@pytest.mark.parametrize("case", ["currency", "expense", "both"])
def test_guarded_downgrade_preserves_schema_and_version(migration_case, case):
    engine, migrate, _ = migration_case
    migrate("upgrade", REVISION)
    with engine.begin() as conn:
        if case in ("currency", "both"):
            conn.execute(
                text(
                    "UPDATE receipts SET "
                    "currency='CNY',exchange_rate=70,rate_date='2026-10-14',"
                    "rate_source='manual' WHERE number=1"
                )
            )
        if case in ("expense", "both"):
            conn.execute(
                text(
                    "INSERT INTO receipt_expenses "
                    "(receipt_id,kind,amount_minor,currency,exchange_rate,amount_tiyn) SELECT "
                    "id,'delivery',100,'KZT',1,100 FROM receipts WHERE number=1"
                )
            )
    with engine.connect() as conn:
        before = legacy_contents(conn)
        before_columns = {
            table: [c["name"] for c in inspect(conn).get_columns(table)]
            for table in (
                "receipts",
                "receipt_lines",
                "receipt_expenses",
                "receipt_expense_allocations",
                "business_settings",
            )
        }
    result = migrate("downgrade", PREVIOUS, check=False)
    assert result.returncode != 0
    assert "Откат миграции невозможен" in result.stderr
    assert "из резервной копии (deploy/restore.sh)" in result.stderr
    assert f"валютных приходов: {int(case in ('currency', 'both'))}" in result.stderr
    assert f"расходов: {int(case in ('expense', 'both'))}" in result.stderr
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT version_num FROM alembic_version")) == REVISION
        assert legacy_contents(conn) == before
        assert {
            table: [c["name"] for c in inspect(conn).get_columns(table)] for table in before_columns
        } == before_columns
