import os
import subprocess
import uuid

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from tests import factories
from tests.conftest import BACKEND_DIR, test_engine

PREVIOUS = "7f3c8a921024"
REVISION = "8a4d2b731025"


@pytest.fixture
def migration_case():
    schema = "rates_migration_" + uuid.uuid4().hex
    options = f"-csearch_path={schema},public"
    with test_engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(test_engine.url, connect_args={"options": options})
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE alembic_version (version_num varchar(32) PRIMARY KEY)"))

    def migrate(direction, revision):
        subprocess.run(
            ["uv", "run", "alembic", direction, revision],
            cwd=BACKEND_DIR,
            env={
                **os.environ,
                "DATABASE_URL": test_engine.url.render_as_string(hide_password=False),
                "PGOPTIONS": options,
            },
            capture_output=True,
            text=True,
            check=True,
        )

    try:
        migrate("upgrade", PREVIOUS)
        yield engine, migrate
    finally:
        engine.dispose()
        with test_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


def contents(conn):
    return {
        table: conn.execute(text(f'SELECT * FROM "{table}" ORDER BY 1')).mappings().all()
        for table in inspect(conn).get_table_names()
        if table not in ("alembic_version", "exchange_rates")
    }


@pytest.mark.parametrize("with_data", [False, True])
def test_upgrade_downgrade_preserves_existing_data(migration_case, with_data):
    engine, migrate = migration_case
    if with_data:
        with Session(engine) as db:
            user = factories.create_user(db)
            product = factories.create_product(db)
            # Seed the historical schema with SQL: current receipt models need newer columns.
            receipt = db.scalar(
                text(
                    "INSERT INTO receipts (number,request_id,created_by) VALUES "
                    "(1,:request,:user) RETURNING id"
                ),
                {"request": uuid.uuid4(), "user": user.id},
            )
            db.execute(
                text(
                    "INSERT INTO receipt_lines "
                    "(receipt_id,product_id,article,name,unit,qty,unit_cost) "
                    "VALUES (:receipt,:product,:article,:name,:unit,3,101)"
                ),
                {
                    "receipt": receipt,
                    "product": product.id,
                    "article": product.article,
                    "name": product.name,
                    "unit": product.unit,
                },
            )
            warehouse = db.scalar(text("SELECT id FROM warehouses WHERE code='main'"))
            db.execute(
                text(
                    "INSERT INTO stock_movements "
                    "(product_id,warehouse_id,qty,kind,doc_type,doc_id,unit_cost,created_by) "
                    "VALUES (:product,:warehouse,3,'receipt','receipt',:receipt,101,:user)"
                ),
                {
                    "product": product.id,
                    "warehouse": warehouse,
                    "receipt": receipt,
                    "user": user.id,
                },
            )
            db.execute(
                text(
                    "INSERT INTO stock_balances (product_id,warehouse_id,qty,avg_cost) VALUES "
                    "(:product,:warehouse,3,101)"
                ),
                {"product": product.id, "warehouse": warehouse},
            )
            db.execute(text("UPDATE document_counters SET last_number=1 WHERE doc_type='receipt'"))
            db.commit()
    with engine.connect() as conn:
        before = contents(conn)
    for direction, revision in [
        ("upgrade", REVISION),
        ("downgrade", PREVIOUS),
        ("upgrade", REVISION),
    ]:
        migrate(direction, revision)
        with engine.connect() as conn:
            assert contents(conn) == before
            assert conn.scalar(text("SELECT version_num FROM alembic_version")) == revision
            inspector = inspect(conn)
            tables = inspector.get_table_names(schema=conn.scalar(text("SELECT current_schema()")))
            assert ("exchange_rates" in tables) == (direction == "upgrade")
            if direction == "downgrade":
                continue
            assert inspector.get_pk_constraint("exchange_rates")["constrained_columns"] == [
                "rate_date",
                "currency",
            ]
            columns = {c["name"]: c for c in inspector.get_columns("exchange_rates")}
            assert str(columns["rate"]["type"]) == "NUMERIC(12, 4)"
            assert columns["published_date"]["nullable"]
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO exchange_rates (rate_date,currency,rate,source) "
                    "VALUES ('2026-10-16','CNY',67.87,'nbk')"
                )
            )
        for currency, rate, source in [
            ("CNY", "0", "nbk"),
            ("CNY", "-1", "nbk"),
            ("EUR", "1", "nbk"),
            ("USD", "1", "manual"),
            ("USD", "NaN", "nbk"),
            ("CNY", "67.87", "nbk"),
        ]:
            with pytest.raises(DBAPIError), engine.begin() as conn:
                conn.execute(
                    text(
                        "INSERT INTO exchange_rates (rate_date,currency,rate,source) "
                        "VALUES ('2026-10-16',:currency,:rate,:source)"
                    ),
                    {"currency": currency, "rate": rate, "source": source},
                )
