import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


def _migration(conn, direction):
    path = (
        Path(__file__).resolve().parents[1]
        / "migrations/versions/2a7c9e41b603_average_cost_and_payment_method.py"
    )
    spec = importlib.util.spec_from_file_location("cost_migration", path)
    revision = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(revision)
    with Operations.context(MigrationContext.configure(conn)):
        getattr(revision, direction)()


def test_cost_backfill_upgrade_downgrade_upgrade(isolated_stock_engine):
    with isolated_stock_engine.begin() as conn:
        _migration(conn, "downgrade")
        user = conn.scalar(
            text(
                "INSERT INTO users (username,password_hash,full_name) VALUES "
                "('migration','test','Test') RETURNING id"
            )
        )
        customer = conn.scalar(
            text("INSERT INTO customers (name) VALUES ('Migration') RETURNING id")
        )
        products = [
            conn.scalar(
                text(
                    "INSERT INTO products (article,article_norm,name) VALUES "
                    "(:a,:a,:a) RETURNING id"
                ),
                {"a": f"MIG-{index}"},
            )
            for index in range(3)
        ]
        warehouse = conn.scalar(text("SELECT id FROM warehouses WHERE code='main'"))
        for number, product, qty, cost, status in [
            (1, products[0], 3, 100, "posted"),
            (2, products[0], 1, 102, "posted"),
            (3, products[0], 20, None, "posted"),
            (4, products[0], 99, 999, "cancelled"),
            (5, products[1], 2, None, "posted"),
            (6, products[2], 2, 55, "posted"),
        ]:
            receipt = conn.scalar(
                text(
                    "INSERT INTO receipts (number,created_by,status,cancelled_at) "
                    "VALUES (:n,:u,:s,CASE WHEN :s='cancelled' THEN now() ELSE NULL "
                    "END) RETURNING id"
                ),
                {"n": number, "u": user, "s": status},
            )
            conn.execute(
                text(
                    "INSERT INTO receipt_lines "
                    "(receipt_id,product_id,qty,unit_cost,unit_price_minor,goods_total,article,"
                    "name,unit)  "
                    "VALUES (:r,:p,:q,:c,:c,:total,'MIG','Migration','шт')"
                ),
                {
                    "r": receipt,
                    "p": product,
                    "q": qty,
                    "c": cost,
                    "total": qty * cost if cost is not None else None,
                },
            )
        for product, qty in zip(products, [24, 2, 0], strict=True):
            conn.execute(
                text("INSERT INTO stock_balances (product_id,warehouse_id,qty) VALUES (:p,:w,:q)"),
                {"p": product, "w": warehouse, "q": qty},
            )
        conn.execute(
            text(
                "INSERT INTO stock_movements "
                "(product_id,warehouse_id,qty,kind,created_by) VALUES "
                "(:p,:w,24,'receipt',:u)"
            ),
            {"p": products[0], "w": warehouse, "u": user},
        )
        for number, paid in [(1, 50), (2, 0)]:
            conn.execute(
                text(
                    "INSERT INTO sales "
                    "(number,request_id,customer_id,total,paid_at_sale,created_by,"
                    "seller_name,seller_iin_bin,responsible_person,"
                    "released_by_name,chief_accountant) "
                    "VALUES (:n,gen_random_uuid(),:c,100,:p,:u,'','','','','')"
                ),
                {"n": number, "c": customer, "p": paid, "u": user},
            )
        conn.execute(
            text(
                "INSERT INTO sale_lines "
                "(sale_id,product_id,qty,unit_price,line_total,article,name,unit) "
                "VALUES ((SELECT id FROM sales WHERE number=1),:p,1,100,100,'MIG','Migration','шт')"
            ),
            {"p": products[0]},
        )
        conn.execute(
            text(
                "INSERT INTO customer_payments "
                "(number,request_id,customer_id,amount,created_by) VALUES "
                "(1,gen_random_uuid(),:c,10,:u)"
            ),
            {"c": customer, "u": user},
        )
        for direction in ["upgrade", "downgrade", "upgrade"]:
            _migration(conn, direction)
            if direction == "downgrade":
                assert conn.scalar(text("SELECT count(*) FROM stock_movements")) == 1
                continue
            assert conn.execute(
                text("SELECT avg_cost FROM stock_balances ORDER BY product_id")
            ).scalars().all() == [101, None, 55]
            assert conn.execute(
                text("SELECT payment_method FROM sales ORDER BY number")
            ).scalars().all() == ["cash", None]
            assert conn.scalar(text("SELECT payment_method FROM customer_payments")) == "cash"
            assert conn.scalar(text("SELECT unit_cost FROM stock_movements")) is None
            assert conn.scalar(text("SELECT unit_cost FROM sale_lines")) is None
            assert conn.scalar(text("SELECT min_qty FROM products LIMIT 1")) is None
            assert (
                conn.scalar(
                    text(
                        "SELECT column_default FROM information_schema.columns WHERE "
                        "table_schema=current_schema() AND "
                        "table_name='customer_payments' AND "
                        "column_name='payment_method'"
                    )
                )
                is None
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
            with pytest.raises(DBAPIError, match="append-only"), conn.begin_nested():
                conn.execute(text("UPDATE stock_movements SET unit_cost=1"))
