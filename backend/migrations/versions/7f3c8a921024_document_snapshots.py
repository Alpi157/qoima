"""Document snapshots and explicit adjustment cost.

Revision ID: 7f3c8a921024
Revises: 6e2a4b9c1022
"""

import sqlalchemy as sa
from alembic import op

revision = "7f3c8a921024"
down_revision = "6e2a4b9c1022"
branch_labels = None
depends_on = None

LINE_TABLES = ("sale_lines", "receipt_lines", "sale_return_lines")
REQUISITES = (
    "seller_name",
    "seller_iin_bin",
    "responsible_person",
    "released_by_name",
    "chief_accountant",
)


def upgrade() -> None:
    for table in LINE_TABLES:
        for field in ("article", "name", "unit"):
            op.add_column(table, sa.Column(field, sa.Text(), nullable=True))
    op.add_column("sale_lines", sa.Column("list_price", sa.BigInteger(), nullable=True))
    op.create_check_constraint("list_price_non_negative", "sale_lines", "list_price >= 0")
    for field in (*REQUISITES, "customer_name", "customer_phone"):
        op.add_column("sales", sa.Column(field, sa.Text(), nullable=True))
    op.add_column(
        "stock_movements", sa.Column("requested_unit_cost", sa.BigInteger(), nullable=True)
    )
    op.create_check_constraint(
        "requested_unit_cost_non_negative", "stock_movements", "requested_unit_cost >= 0"
    )

    for table in ("sale_lines", "receipt_lines"):
        op.execute(f"""
            UPDATE {table} AS line
            SET article = product.article, name = product.name, unit = product.unit
            FROM products AS product WHERE product.id = line.product_id
        """)
    op.execute("""
        UPDATE sale_return_lines AS line
        SET article = original.article, name = original.name, unit = original.unit
        FROM sale_lines AS original WHERE original.id = line.sale_line_id
    """)
    op.execute("""
        UPDATE sales AS sale
        SET seller_name = snapshot.seller_name,
            seller_iin_bin = snapshot.seller_iin_bin,
            responsible_person = snapshot.responsible_person,
            released_by_name = snapshot.released_by_name,
            chief_accountant = snapshot.chief_accountant,
            customer_name = snapshot.customer_name,
            customer_phone = snapshot.customer_phone
        FROM (
            SELECT original.id,
                COALESCE(settings.seller_name, '') AS seller_name,
                COALESCE(settings.seller_iin_bin, '') AS seller_iin_bin,
                COALESCE(settings.responsible_person, '') AS responsible_person,
                COALESCE(NULLIF(settings.released_by_name, ''), author.full_name)
                    AS released_by_name,
                COALESCE(settings.chief_accountant, '') AS chief_accountant,
                customer.name AS customer_name, customer.phone AS customer_phone
            FROM sales AS original
            JOIN users AS author ON author.id = original.created_by
            LEFT JOIN business_settings AS settings ON settings.id = 1
            LEFT JOIN customers AS customer ON customer.id = original.customer_id
        ) AS snapshot
        WHERE snapshot.id = sale.id
    """)
    for table in LINE_TABLES:
        for field in ("article", "name", "unit"):
            op.alter_column(table, field, nullable=False)
    for field in REQUISITES:
        op.alter_column("sales", field, nullable=False)


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_stock_movements_requested_unit_cost_non_negative"),
        "stock_movements",
        type_="check",
    )
    op.drop_column("stock_movements", "requested_unit_cost")
    for field in (*REQUISITES, "customer_name", "customer_phone"):
        op.drop_column("sales", field)
    op.drop_constraint(op.f("ck_sale_lines_list_price_non_negative"), "sale_lines", type_="check")
    op.drop_column("sale_lines", "list_price")
    for table in reversed(LINE_TABLES):
        for field in ("article", "name", "unit"):
            op.drop_column(table, field)
