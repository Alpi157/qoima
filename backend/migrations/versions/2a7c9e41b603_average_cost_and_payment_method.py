"""Average inventory cost, payment methods and minimum stock.

Revision ID: 2a7c9e41b603
Revises: 8e41b7c290da
"""

import sqlalchemy as sa
from alembic import op

revision = "2a7c9e41b603"
down_revision = "8e41b7c290da"
branch_labels = None
depends_on = None

NON_NEGATIVE_COLUMNS = (
    ("stock_balances", "avg_cost", sa.BigInteger),
    ("stock_movements", "unit_cost", sa.BigInteger),
    ("sale_lines", "unit_cost", sa.BigInteger),
    ("products", "min_qty", sa.Integer),
)


def upgrade() -> None:
    for table, column, column_type in NON_NEGATIVE_COLUMNS:
        op.add_column(table, sa.Column(column, column_type(), nullable=True))
        op.create_check_constraint(
            op.f(f"ck_{table}_{column}_non_negative"), table, f"{column} >= 0"
        )
    op.add_column("sales", sa.Column("payment_method", sa.Text(), nullable=True))
    op.execute("UPDATE sales SET payment_method = 'cash' WHERE paid_at_sale > 0")
    op.create_check_constraint(
        op.f("ck_sales_payment_method_valid"), "sales", "payment_method IN ('cash', 'card')"
    )
    op.create_check_constraint(
        op.f("ck_sales_payment_method_consistent"),
        "sales",
        "(paid_at_sale > 0) = (payment_method IS NOT NULL)",
    )
    op.add_column("customer_payments", sa.Column("payment_method", sa.Text(), nullable=True))
    op.execute("UPDATE customer_payments SET payment_method = 'cash'")
    op.alter_column("customer_payments", "payment_method", nullable=False)
    op.create_check_constraint(
        op.f("ck_customer_payments_payment_method_valid"),
        "customer_payments",
        "payment_method IN ('cash', 'card')",
    )
    # Exact numeric intermediates avoid bigint overflow; floor implements half-up.
    # Historical movements remain untouched: their append-only trigger stays enabled.
    op.execute("""
        UPDATE stock_balances AS b
        SET avg_cost = costs.avg_cost
        FROM (
            SELECT l.product_id,
                   floor((2 * sum(l.qty::numeric * l.unit_cost) + sum(l.qty)::numeric)
                         / (2 * sum(l.qty)::numeric))::bigint AS avg_cost
            FROM receipt_lines AS l
            JOIN receipts AS r ON r.id = l.receipt_id
            WHERE r.status = 'posted' AND l.unit_cost IS NOT NULL
            GROUP BY l.product_id
        ) AS costs
        WHERE b.product_id = costs.product_id
    """)


def downgrade() -> None:
    op.drop_constraint(op.f("ck_customer_payments_payment_method_valid"), "customer_payments")
    op.drop_column("customer_payments", "payment_method")
    op.drop_constraint(op.f("ck_sales_payment_method_consistent"), "sales")
    op.drop_constraint(op.f("ck_sales_payment_method_valid"), "sales")
    op.drop_column("sales", "payment_method")
    for table, column, _ in reversed(NON_NEGATIVE_COLUMNS):
        op.drop_constraint(op.f(f"ck_{table}_{column}_non_negative"), table)
        op.drop_column(table, column)
