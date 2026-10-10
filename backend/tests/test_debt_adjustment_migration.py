import os
import subprocess
import uuid

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from tests.conftest import BACKEND_DIR, test_engine

PREVIOUS = "31a7d9e602bf"
REVISION = "42b8e0f713ac"


@pytest.fixture
def migration_case():
    schema = "debt_adjustment_migration_" + uuid.uuid4().hex
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
            customer = conn.scalar(
                text("INSERT INTO customers (name) VALUES ('Migration') RETURNING id")
            )
            sale = conn.scalar(
                text(
                    "INSERT INTO sales "
                    "(number,request_id,customer_id,total,paid_at_sale,created_by) "
                    "VALUES (1,gen_random_uuid(),:c,100,0,:u) RETURNING id"
                ),
                {"c": customer, "u": user},
            )
            conn.execute(
                text(
                    "INSERT INTO customer_payments "
                    "(number,request_id,customer_id,amount,payment_method,created_by) "
                    "VALUES (1,gen_random_uuid(),:c,20,'cash',:u)"
                ),
                {"c": customer, "u": user},
            )
            conn.execute(
                text(
                    "INSERT INTO sale_returns "
                    "(number,request_id,sale_id,customer_id,total,debt_credit,"
                    "refund_amount,created_by) "
                    "VALUES (1,gen_random_uuid(),:s,:c,10,10,0,:u)"
                ),
                {"s": sale, "c": customer, "u": user},
            )
            conn.execute(text("UPDATE document_counters SET last_number=1"))
        yield engine, migrate, {"user": user, "customer": customer}
    finally:
        engine.dispose()
        with test_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


def insert(conn, ids, **changes):
    values = {
        "number": 1,
        "request_id": uuid.uuid4(),
        "customer": ids["customer"],
        "amount": 100,
        "reason": "Opening",
        "status": "posted",
        "cancelled_at": None,
        **ids,
        **changes,
    }
    return conn.scalar(
        text("""INSERT INTO customer_debt_adjustments
        (number,request_id,customer_id,amount,reason,status,cancelled_at,created_by)
        VALUES (:number,:request_id,:customer,:amount,:reason,:status,:cancelled_at,:user)
        RETURNING id"""),
        values,
    )


def test_upgrade_downgrade_upgrade_preserves_existing_documents(migration_case):
    engine, migrate, ids = migration_case
    for direction, revision in [
        ("upgrade", REVISION),
        ("downgrade", PREVIOUS),
        ("upgrade", REVISION),
    ]:
        migrate(direction, revision)
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT total FROM sales")) == 100
            assert conn.scalar(text("SELECT amount FROM customer_payments")) == 20
            assert conn.scalar(text("SELECT debt_credit FROM sale_returns")) == 10
            assert conn.scalar(text("SELECT version_num FROM alembic_version")) == revision
            assert (
                conn.scalar(
                    text(
                        "SELECT count(*) FROM document_counters "
                        "WHERE doc_type!='debt_adjustment' AND last_number=1"
                    )
                )
                == 4
            )
            if direction == "upgrade":
                assert (
                    conn.scalar(
                        text(
                            "SELECT last_number FROM document_counters "
                            "WHERE doc_type='debt_adjustment'"
                        )
                    )
                    == 0
                )
                inspector = inspect(conn)
                columns = {
                    column["name"]: column
                    for column in inspector.get_columns("customer_debt_adjustments")
                }
                assert (
                    columns["amount"]["nullable"] is False
                    and columns["customer_id"]["nullable"] is False
                )
                assert columns["reason"]["nullable"] is False
                assert columns["adjusted_at"]["type"].timezone
                assert {
                    index["name"] for index in inspector.get_indexes("customer_debt_adjustments")
                } >= {
                    "ix_customer_debt_adjustments_customer_id",
                    "ix_customer_debt_adjustments_adjusted_at",
                }
            else:
                assert "customer_debt_adjustments" not in inspect(conn).get_table_names(
                    schema=conn.scalar(text("SELECT current_schema()"))
                )


@pytest.mark.parametrize("cancelled", [False, True])
def test_downgrade_refuses_all_adjustments_before_changing_schema(migration_case, cancelled):
    engine, migrate, ids = migration_case
    migrate("upgrade", REVISION)
    with engine.begin() as conn:
        insert(
            conn,
            ids,
            status="cancelled" if cancelled else "posted",
            cancelled_at="2026-01-01T00:00:00Z" if cancelled else None,
        )
        conn.execute(
            text("UPDATE document_counters SET last_number=1 WHERE doc_type='debt_adjustment'")
        )
    result = migrate("downgrade", PREVIOUS, check=False)
    assert result.returncode != 0
    assert "найдено исправлений долга: 1" in result.stderr
    assert "из резервной копии (deploy/restore.sh)" in result.stderr
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT version_num FROM alembic_version")) == REVISION
        assert conn.scalar(text("SELECT count(*) FROM customer_debt_adjustments")) == 1
        assert (
            conn.scalar(
                text("SELECT last_number FROM document_counters WHERE doc_type='debt_adjustment'")
            )
            == 1
        )
        assert "'debt_adjustment'" in conn.scalar(
            text(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                "WHERE conname='ck_document_counters_doc_type_valid' "
                "AND conrelid='document_counters'::regclass"
            )
        )


@pytest.mark.parametrize(
    "changes",
    [
        {"amount": 0},
        {"reason": ""},
        {"reason": "  "},
        {"reason": None},
        {"customer": None},
        {"customer": 9223372036854775807},
        {"status": "other"},
        {"status": "cancelled"},
    ],
)
def test_migrated_database_constraints(migration_case, changes):
    engine, migrate, ids = migration_case
    migrate("upgrade", REVISION)
    with pytest.raises(IntegrityError), engine.begin() as conn:
        insert(conn, ids, **changes)


@pytest.mark.parametrize("field", ["number", "request_id"])
def test_unique_number_and_request_id(migration_case, field):
    engine, migrate, ids = migration_case
    migrate("upgrade", REVISION)
    request_id = uuid.uuid4()
    with engine.begin() as conn:
        insert(conn, ids, request_id=request_id)
    with pytest.raises(IntegrityError), engine.begin() as conn:
        insert(
            conn,
            ids,
            number=1 if field == "number" else 2,
            request_id=request_id if field == "request_id" else uuid.uuid4(),
        )
