"""Customer debts and payments.

Revision ID: 8e41b7c290da
Revises: 5c1f2a7d9e30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "8e41b7c290da"
down_revision: str | Sequence[str] | None = "5c1f2a7d9e30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("sales", sa.Column("paid_at_sale", sa.BigInteger(), nullable=True))
    op.execute("UPDATE sales SET paid_at_sale = total")
    op.alter_column("sales", "paid_at_sale", nullable=False)
    op.create_check_constraint(
        op.f("ck_sales_paid_at_sale_range"), "sales", "paid_at_sale >= 0 AND paid_at_sale <= total"
    )
    op.create_check_constraint(
        op.f("ck_sales_debt_requires_customer"),
        "sales",
        "paid_at_sale = total OR customer_id IS NOT NULL",
    )
    op.drop_constraint(
        op.f("ck_document_counters_doc_type_valid"), "document_counters", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_document_counters_doc_type_valid"),
        "document_counters",
        "doc_type IN ('receipt', 'sale', 'payment')",
    )
    op.execute("INSERT INTO document_counters (doc_type, last_number) VALUES ('payment', 0)")
    op.create_table(
        "customer_payments",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("number", sa.BigInteger(), nullable=False),
        sa.Column("request_id", sa.UUID(), nullable=False),
        sa.Column("customer_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "paid_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), server_default=sa.text("'posted'"), nullable=False),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_by", sa.BigInteger(), nullable=True),
        sa.Column("cancel_reason", sa.Text(), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("amount > 0", name=op.f("ck_customer_payments_amount_positive")),
        sa.CheckConstraint(
            "status IN ('posted', 'cancelled')", name=op.f("ck_customer_payments_status_valid")
        ),
        sa.CheckConstraint(
            "(status = 'cancelled') = (cancelled_at IS NOT NULL)",
            name=op.f("ck_customer_payments_cancelled_consistent"),
        ),
        sa.ForeignKeyConstraint(
            ["customer_id"],
            ["customers.id"],
            name=op.f("fk_customer_payments_customer_id_customers"),
        ),
        sa.ForeignKeyConstraint(
            ["cancelled_by"], ["users.id"], name=op.f("fk_customer_payments_cancelled_by_users")
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_customer_payments_created_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_customer_payments")),
        sa.UniqueConstraint("number", name=op.f("uq_customer_payments_number")),
        sa.UniqueConstraint("request_id", name=op.f("uq_customer_payments_request_id")),
    )
    op.create_index(op.f("ix_customer_payments_customer_id"), "customer_payments", ["customer_id"])
    op.create_index(op.f("ix_customer_payments_paid_at"), "customer_payments", ["paid_at"])


def downgrade() -> None:
    op.drop_index(op.f("ix_customer_payments_paid_at"), table_name="customer_payments")
    op.drop_index(op.f("ix_customer_payments_customer_id"), table_name="customer_payments")
    op.drop_table("customer_payments")
    op.execute("DELETE FROM document_counters WHERE doc_type = 'payment'")
    op.drop_constraint(
        op.f("ck_document_counters_doc_type_valid"), "document_counters", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_document_counters_doc_type_valid"),
        "document_counters",
        "doc_type IN ('receipt', 'sale')",
    )
    op.drop_constraint(op.f("ck_sales_debt_requires_customer"), "sales", type_="check")
    op.drop_constraint(op.f("ck_sales_paid_at_sale_range"), "sales", type_="check")
    op.drop_column("sales", "paid_at_sale")
