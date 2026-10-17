import os
import subprocess
import uuid

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import DBAPIError

from tests.conftest import BACKEND_DIR, test_engine

PREVIOUS = "6e2a4b9c1022"
REVISION = "7f3c8a921024"
REQUISITES = (
    "seller_name",
    "seller_iin_bin",
    "responsible_person",
    "released_by_name",
    "chief_accountant",
)


@pytest.fixture
def migration_case():
    schema = "snapshot_migration_" + uuid.uuid4().hex
    with test_engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    options = f"-csearch_path={schema},public"
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


def seed(conn, released):
    user = conn.scalar(
        text(
            "INSERT INTO users (username,password_hash,full_name) VALUES "
            "('author','test','Original author') RETURNING id"
        )
    )
    customer = conn.scalar(
        text("INSERT INTO customers (name,phone) VALUES ('Old customer','111') RETURNING id")
    )
    conn.execute(
        text(
            "UPDATE business_settings SET "
            "seller_name='Seller',seller_iin_bin='123456789012',"
            "responsible_person='Responsible',chief_accountant='Accountant',released_by_name=:released"
        ),
        {"released": released},
    )
    for number in (1, 2):
        product = conn.scalar(
            text(
                "INSERT INTO products (article,article_norm,name,unit,sale_price,is_archived) "
                "VALUES (:a,:a,'Old name','шт',200,:archived) RETURNING id"
            ),
            {"a": f"ITEM{number}", "archived": number == 2},
        )
        sale = conn.scalar(
            text(
                "INSERT INTO sales "
                "(number,request_id,customer_id,total,paid_at_sale,payment_method,created_by) "
                "VALUES (:n,gen_random_uuid(),:c,200,200,'cash',:u) RETURNING id"
            ),
            {"n": number, "c": customer if number == 1 else None, "u": user},
        )
        sale_line = conn.scalar(
            text(
                "INSERT INTO sale_lines "
                "(sale_id,product_id,qty,unit_price,line_total,unit_cost) VALUES "
                "(:s,:p,2,100,200,50) RETURNING id"
            ),
            {"s": sale, "p": product},
        )
        receipt = conn.scalar(
            text("INSERT INTO receipts (number,created_by) VALUES (:n,:u) RETURNING id"),
            {"n": number, "u": user},
        )
        conn.execute(
            text(
                "INSERT INTO receipt_lines (receipt_id,product_id,qty,unit_cost) VALUES "
                "(:r,:p,3,50)"
            ),
            {"r": receipt, "p": product},
        )
        returned = conn.scalar(
            text(
                "INSERT INTO sale_returns "
                "(number,request_id,sale_id,customer_id,total,debt_credit,"
                "refund_amount,refund_method,created_by) "
                "VALUES (:n,gen_random_uuid(),:s,:c,100,0,100,'cash',:u) RETURNING id"
            ),
            {"n": number, "s": sale, "c": customer if number == 1 else None, "u": user},
        )
        conn.execute(
            text(
                "INSERT INTO sale_return_lines "
                "(return_id,sale_line_id,product_id,qty,unit_price,line_total,unit_cost,condition) "
                "VALUES (:r,:l,:p,1,100,100,50,'good')"
            ),
            {"r": returned, "l": sale_line, "p": product},
        )
        conn.execute(
            text(
                "INSERT INTO stock_balances (product_id,warehouse_id,qty,avg_cost) VALUES "
                "(:p,(SELECT id FROM warehouses WHERE code='main'),2,50)"
            ),
            {"p": product},
        )
        conn.execute(
            text(
                "INSERT INTO stock_movements "
                "(product_id,warehouse_id,qty,kind,unit_cost,request_id,created_by) VALUES "
                "(:p,(SELECT id FROM warehouses WHERE "
                "code='main'),2,'adjustment',50,gen_random_uuid(),:u)"
            ),
            {"p": product, "u": user},
        )
        conn.execute(
            text(
                "UPDATE products SET article=:a,article_norm=:a,name='Current "
                "name',unit='компл' WHERE id=:p"
            ),
            {"a": f"RENAMED{number}", "p": product},
        )
        if number == 2:
            for table in ("sale_returns", "sales", "receipts"):
                conn.execute(
                    text(
                        f"UPDATE {table} SET status='cancelled', cancelled_at=now(), "
                        "cancel_reason='Historical cancellation' WHERE number=2"
                    )
                )
    conn.execute(text("UPDATE customers SET name='Current customer',phone='222'"))


def contents(conn):
    tables = (
        "sales",
        "sale_lines",
        "receipts",
        "receipt_lines",
        "sale_returns",
        "sale_return_lines",
        "stock_movements",
        "stock_balances",
        "products",
        "customers",
        "business_settings",
        "users",
        "document_counters",
    )
    return {
        table: conn.execute(text(f"SELECT * FROM {table} ORDER BY 1")).mappings().all()
        for table in tables
    }


@pytest.mark.parametrize("released", ["Released from settings", ""])
def test_snapshot_backfill_and_downgrade(migration_case, released):
    engine, migrate = migration_case
    with engine.begin() as conn:
        seed(conn, released)
        before = contents(conn)
    for direction, revision in [
        ("upgrade", REVISION),
        ("downgrade", PREVIOUS),
        ("upgrade", REVISION),
    ]:
        migrate(direction, revision)
        with engine.connect() as conn:
            after = contents(conn)
            for table, rows in before.items():
                assert [
                    {key: row[key] for key in old}
                    for row, old in zip(after[table], rows, strict=True)
                ] == rows
            assert conn.scalar(text("SELECT version_num FROM alembic_version")) == revision
            if direction == "downgrade":
                assert after == before
                assert "article" not in {c["name"] for c in inspect(conn).get_columns("sale_lines")}
                continue
            for table in ("sale_lines", "receipt_lines", "sale_return_lines"):
                assert [
                    tuple(row[k] for k in ("article", "name", "unit")) for row in after[table]
                ] == [(f"RENAMED{n}", "Current name", "компл") for n in (1, 2)]
                assert all(
                    not c["nullable"]
                    for c in inspect(conn).get_columns(table)
                    if c["name"] in ("article", "name", "unit")
                )
            assert all(row["list_price"] is None for row in after["sale_lines"])
            assert all(row["requested_unit_cost"] is None for row in after["stock_movements"])
            for row in after["sales"]:
                assert tuple(row[k] for k in REQUISITES) == (
                    "Seller",
                    "123456789012",
                    "Responsible",
                    released or "Original author",
                    "Accountant",
                )
            assert after["sales"][0]["customer_name"] == "Current customer"
            assert after["sales"][0]["customer_phone"] == "222"
            assert after["sales"][1]["customer_name"] is None
            assert after["sales"][1]["customer_phone"] is None
        for statement in (
            "UPDATE stock_movements SET qty=qty",
            "DELETE FROM stock_movements",
            "TRUNCATE stock_movements",
        ):
            with pytest.raises(DBAPIError, match="append-only"), engine.begin() as conn:
                conn.execute(text(statement))


def test_empty_upgrade_and_downgrade(migration_case):
    engine, migrate = migration_case
    for direction, revision in [
        ("upgrade", REVISION),
        ("downgrade", PREVIOUS),
        ("upgrade", REVISION),
    ]:
        migrate(direction, revision)
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT count(*) FROM sales")) == 0
            assert conn.scalar(text("SELECT version_num FROM alembic_version")) == revision


def test_missing_settings_uses_empty_requisites_and_author(migration_case):
    engine, migrate = migration_case
    with engine.begin() as conn:
        seed(conn, "Unused")
        conn.execute(text("DELETE FROM business_settings"))
    migrate("upgrade", REVISION)
    with engine.connect() as conn:
        for row in conn.execute(text("SELECT * FROM sales")).mappings():
            assert (
                row["seller_name"]
                == row["seller_iin_bin"]
                == row["chief_accountant"]
                == row["responsible_person"]
                == ""
            )
            assert row["released_by_name"] == "Original author"
