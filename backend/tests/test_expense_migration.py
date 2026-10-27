import os
import subprocess
import uuid

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from tests.conftest import BACKEND_DIR, test_engine

PREVIOUS = "b7f4e1921026"
REVISION = "c8a5e3921029"


@pytest.fixture
def migration_case():
    schema = "expense_migration_" + uuid.uuid4().hex
    with test_engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    options = f"-csearch_path={schema},public"
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
        with engine.begin() as conn:
            user = conn.scalar(
                text(
                    "INSERT INTO users (username,password_hash,full_name) "
                    "VALUES ('migration','test','Test') RETURNING id"
                )
            )
            product = conn.scalar(
                text(
                    "INSERT INTO products (article,article_norm,name,unit,sale_price) "
                    "VALUES ('MIG-28','MIG28','Migration','шт',100) RETURNING id"
                )
            )
        yield engine, migrate, {"user": user, "product": product}
    finally:
        engine.dispose()
        with test_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


def insert(conn, ids, **changes):
    values = {
        "request_id": uuid.uuid4(),
        "index": 0,
        "number": 1,
        "category": "rent",
        "amount": 100,
        "status": "posted",
        "cancelled": None,
        **ids,
        **changes,
    }
    conn.execute(
        text(
            "INSERT INTO expenses (number,request_id,request_index,expense_date,category,"
            "amount,status,cancelled_at,created_by) VALUES "
            "(:number,:request_id,:index,'2026-09-30',:category,:amount,:status,:cancelled,:user)"
        ),
        values,
    )


def test_upgrade_downgrade_upgrade(migration_case):
    engine, migrate, ids = migration_case
    for direction, target in [
        ("upgrade", REVISION),
        ("downgrade", PREVIOUS),
        ("upgrade", REVISION),
    ]:
        migrate(direction, target)
        with engine.connect() as conn:
            assert (
                conn.scalar(text("SELECT sale_price FROM products WHERE id=:product"), ids) == 100
            )
            assert conn.scalar(text("SELECT version_num FROM alembic_version")) == target
            if direction == "upgrade":
                assert "ix_expenses_status_expense_date" in {
                    item["name"] for item in inspect(conn).get_indexes("expenses")
                }
                assert (
                    conn.scalar(
                        text("SELECT last_number FROM document_counters WHERE doc_type='expense'")
                    )
                    == 0
                )
                assert tuple(
                    conn.execute(
                        text("SELECT card_commission_bp,tax_bp FROM business_settings")
                    ).one()
                ) == (0, 0)


@pytest.mark.parametrize("cancelled", [False, True])
def test_downgrade_refuses_all_expenses_atomically(migration_case, cancelled):
    engine, migrate, ids = migration_case
    migrate("upgrade", REVISION)
    with engine.begin() as conn:
        insert(
            conn,
            ids,
            status="cancelled" if cancelled else "posted",
            cancelled="2026-10-01T00:00:00Z" if cancelled else None,
        )
    result = migrate("downgrade", PREVIOUS, check=False)
    assert result.returncode != 0 and "найдено расходов: 1" in result.stderr
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT version_num FROM alembic_version")) == REVISION
        assert conn.scalar(text("SELECT count(*) FROM expenses")) == 1
        assert (
            conn.scalar(text("SELECT count(*) FROM document_counters WHERE doc_type='expense'"))
            == 1
        )
        assert conn.scalar(text("SELECT tax_bp FROM business_settings")) == 0


@pytest.mark.parametrize(
    "changes",
    [
        {"amount": 0},
        {"category": "invalid"},
        {"status": "cancelled"},
        {"status": "other"},
        {"request_id": None},
        {"index": None},
    ],
)
def test_constraints(migration_case, changes):
    engine, migrate, ids = migration_case
    migrate("upgrade", REVISION)
    with pytest.raises(IntegrityError), engine.begin() as conn:
        insert(conn, ids, **changes)


def test_unique_batch_index_and_rates(migration_case):
    engine, migrate, ids = migration_case
    migrate("upgrade", REVISION)
    request_id = uuid.uuid4()
    with engine.begin() as conn:
        insert(conn, ids, request_id=request_id)
        insert(conn, ids, request_id=request_id, index=1, number=2)
    with pytest.raises(IntegrityError), engine.begin() as conn:
        insert(conn, ids, request_id=request_id, number=3)
    for field in ("card_commission_bp", "tax_bp"):
        for value in (-1, 10001):
            with pytest.raises(IntegrityError), engine.begin() as conn:
                conn.execute(text(f"UPDATE business_settings SET {field}=:value"), {"value": value})
