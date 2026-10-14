import os
import subprocess
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from tests.conftest import BACKEND_DIR, test_engine

PREVIOUS = "2a7c9e41b603"
REVISION = "31a7d9e602bf"


@pytest.fixture
def migration_case():
    schema = f"returns_migration_{uuid.uuid4().hex}"
    with test_engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    url = test_engine.url
    options = f"-csearch_path={schema},public"
    engine = create_engine(url, connect_args={"options": options})
    with engine.begin() as conn:
        # Do not let Alembic discover public.alembic_version through search_path.
        conn.execute(text("CREATE TABLE alembic_version (version_num varchar(32) PRIMARY KEY)"))

    def migrate(direction, revision, check=True):
        return subprocess.run(
            ["uv", "run", "alembic", direction, revision],
            cwd=BACKEND_DIR,
            env={
                **os.environ,
                "DATABASE_URL": url.render_as_string(hide_password=False),
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
            customer = conn.scalar(
                text("INSERT INTO customers (name) VALUES ('Migration') RETURNING id")
            )
            product = conn.scalar(
                text(
                    "INSERT INTO products (article,article_norm,name) "
                    "VALUES ('MIG','MIG','Migration') RETURNING id"
                )
            )
            sale = conn.scalar(
                text(
                    "INSERT INTO sales "
                    "(number,request_id,customer_id,total,paid_at_sale,created_by) "
                    "VALUES (1,gen_random_uuid(),:c,100,0,:u) RETURNING id"
                ),
                {"c": customer, "u": user},
            )
            line = conn.scalar(
                text(
                    "INSERT INTO sale_lines "
                    "(sale_id,product_id,qty,unit_price,line_total,unit_cost) "
                    "VALUES (:s,:p,1,100,100,40) RETURNING id"
                ),
                {"s": sale, "p": product},
            )
            conn.execute(
                text(
                    "INSERT INTO customer_payments "
                    "(number,request_id,customer_id,amount,payment_method,created_by) "
                    "VALUES (1,gen_random_uuid(),:c,10,'cash',:u)"
                ),
                {"c": customer, "u": user},
            )
            receipt = conn.scalar(
                text("INSERT INTO receipts (number,created_by) VALUES (1,:u) RETURNING id"),
                {"u": user},
            )
            conn.execute(
                text(
                    "INSERT INTO receipt_lines (receipt_id,product_id,qty,unit_cost) "
                    "VALUES (:r,:p,1,40)"
                ),
                {"r": receipt, "p": product},
            )
            conn.execute(text("UPDATE document_counters SET last_number=1"))
            # Seed the historical schema without the current ORM's newer columns.
            warehouse = conn.scalar(text("SELECT id FROM warehouses WHERE code='main'"))
            conn.execute(
                text(
                    "INSERT INTO stock_balances (product_id,warehouse_id,qty,avg_cost) "
                    "VALUES (:p,:w,1,40)"
                ),
                {"p": product, "w": warehouse},
            )
            conn.execute(
                text(
                    "INSERT INTO stock_movements "
                    "(product_id,warehouse_id,qty,kind,unit_cost,doc_type,doc_id,created_by) "
                    "VALUES (:p,:w,1,'receipt',40,'receipt',:r,:u)"
                ),
                {"p": product, "w": warehouse, "r": receipt, "u": user},
            )
        yield (
            engine,
            migrate,
            {"user": user, "customer": customer, "sale": sale, "line": line, "product": product},
        )
    finally:
        engine.dispose()
        with test_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


def insert_return(conn, ids, **changes):
    values = {
        "customer": ids["customer"],
        "total": 100,
        "credit": 100,
        "refund": 0,
        "method": None,
        "status": "posted",
        "cancelled_at": None,
        **ids,
        **changes,
    }
    return conn.scalar(
        text("""
        INSERT INTO sale_returns
        (number,request_id,sale_id,customer_id,total,debt_credit,refund_amount,
         refund_method,status,cancelled_at,created_by)
        VALUES (1,gen_random_uuid(),:sale,:customer,:total,:credit,:refund,
                :method,:status,:cancelled_at,:user) RETURNING id
    """),
        values,
    )


def test_upgrade_downgrade_upgrade_with_data(migration_case):
    engine, migrate, ids = migration_case
    for direction, revision in [
        ("upgrade", REVISION),
        ("downgrade", PREVIOUS),
        ("upgrade", REVISION),
    ]:
        migrate(direction, revision)
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT count(*) FROM sales")) == 1
            assert conn.scalar(text("SELECT unit_cost FROM sale_lines")) == 40
            assert conn.scalar(text("SELECT amount FROM customer_payments")) == 10
            assert conn.scalar(text("SELECT unit_cost FROM receipt_lines")) == 40
            assert conn.scalar(text("SELECT qty FROM stock_balances")) == 1
            assert conn.scalar(text("SELECT avg_cost FROM stock_balances")) == 40
            assert conn.scalar(text("SELECT unit_cost FROM stock_movements")) == 40
            assert (
                conn.scalar(
                    text(
                        "SELECT count(*) FROM document_counters WHERE "
                        "doc_type != 'return' AND last_number=1"
                    )
                )
                == 3
            )
            assert (
                conn.scalar(
                    text(
                        "SELECT count(*) FROM pg_trigger WHERE "
                        "tgrelid='stock_movements'::regclass AND "
                        "tgname='stock_movements_append_only'"
                    )
                )
                == 1
            )
            assert conn.scalar(text("SELECT version_num FROM alembic_version")) == revision
            if direction == "upgrade":
                assert (
                    conn.scalar(
                        text("SELECT last_number FROM document_counters WHERE doc_type='return'")
                    )
                    == 0
                )


@pytest.mark.parametrize(
    "changes,constraint",
    [
        ({"refund": 1, "method": "cash"}, "total_matches"),
        ({"method": "cash"}, "refund_method_consistent"),
        ({"customer": None}, "credit_requires_customer"),
        ({"credit": 0, "refund": 100}, "refund_method_consistent"),
        ({"credit": 0, "refund": 100, "method": "wire"}, "refund_method_valid"),
    ],
)
def test_return_checks(migration_case, changes, constraint):
    engine, migrate, ids = migration_case
    migrate("upgrade", REVISION)
    with pytest.raises(IntegrityError, match=constraint), engine.begin() as conn:
        insert_return(conn, ids, **changes)


@pytest.mark.parametrize(
    "changes,constraint",
    [
        ({"qty": 0, "total": 0}, "qty_positive"),
        ({"total": 99}, "line_total_matches"),
        ({"condition": "broken"}, "condition_valid"),
        ({"cost": -1}, "unit_cost_non_negative"),
    ],
)
def test_return_line_checks(migration_case, changes, constraint):
    engine, migrate, ids = migration_case
    migrate("upgrade", REVISION)
    with engine.begin() as conn:
        document = insert_return(conn, ids)
    values = {
        **ids,
        "document": document,
        "qty": 1,
        "total": 100,
        "condition": "good",
        "cost": 40,
        **changes,
    }
    with pytest.raises(IntegrityError, match=constraint), engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO sale_return_lines "
                "(return_id,sale_line_id,product_id,qty,unit_price,line_total,condition,unit_cost) "
                "VALUES (:document,:line,:product,:qty,100,:total,:condition,:cost)"
            ),
            values,
        )


@pytest.mark.parametrize("cancelled", [False, True])
def test_downgrade_refuses_any_return_without_schema_changes(migration_case, cancelled):
    engine, migrate, ids = migration_case
    migrate("upgrade", REVISION)
    with engine.begin() as conn:
        insert_return(
            conn,
            ids,
            status="cancelled" if cancelled else "posted",
            cancelled_at="2026-01-12T10:00:00Z" if cancelled else None,
        )
    result = migrate("downgrade", PREVIOUS, check=False)
    assert result.returncode != 0
    assert "найдено возвратов: 1" in result.stderr
    assert "только восстановлением из резервной копии (deploy/restore.sh)" in result.stderr
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT version_num FROM alembic_version")) == REVISION
        assert conn.scalar(text("SELECT count(*) FROM sale_returns")) == 1
        assert conn.scalar(text("SELECT count(*) FROM sale_return_lines")) == 0
        assert (
            conn.scalar(text("SELECT last_number FROM document_counters WHERE doc_type='return'"))
            == 0
        )
        assert "'return'" in conn.scalar(
            text(
                "SELECT pg_get_constraintdef(oid) "
                "FROM pg_constraint WHERE conname='ck_stock_movements_kind_valid' "
                "AND conrelid='stock_movements'::regclass"
            )
        )
