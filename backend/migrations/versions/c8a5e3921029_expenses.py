"""Business expenses and profit calculation settings.

Revision ID: c8a5e3921029
Revises: b7f4e1921026
"""

import sqlalchemy as sa
from alembic import op

revision = "c8a5e3921029"
down_revision = "b7f4e1921026"
branch_labels = None
depends_on = None


def _counter_check(expenses: bool) -> None:
    types = "'receipt','sale','payment','return','debt_adjustment'" + (
        ",'expense'" if expenses else ""
    )
    op.drop_constraint(
        op.f("ck_document_counters_doc_type_valid"), "document_counters", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_document_counters_doc_type_valid"), "document_counters", f"doc_type IN ({types})"
    )


def upgrade() -> None:
    op.create_table(
        "expenses",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("number", sa.BigInteger(), nullable=False, unique=True),
        sa.Column("request_id", sa.UUID(), nullable=False),
        sa.Column("request_index", sa.Integer(), nullable=False),
        sa.Column("expense_date", sa.Date(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("note", sa.Text()),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'posted'")),
        sa.Column("cancelled_at", sa.DateTime(timezone=True)),
        sa.Column("cancelled_by", sa.BigInteger(), sa.ForeignKey("users.id")),
        sa.Column("cancel_reason", sa.Text()),
        sa.Column("created_by", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint(
            "request_id", "request_index", name="uq_expenses_request_id_request_index"
        ),
        sa.CheckConstraint("amount > 0", name=op.f("ck_expenses_amount_positive")),
        sa.CheckConstraint(
            "category IN ('rent','salary','customer_delivery','communication',"
            "'advertising','taxes','bank','other')",
            name=op.f("ck_expenses_category_valid"),
        ),
        sa.CheckConstraint(
            "status IN ('posted','cancelled')", name=op.f("ck_expenses_status_valid")
        ),
        sa.CheckConstraint(
            "(status = 'cancelled') = (cancelled_at IS NOT NULL)",
            name=op.f("ck_expenses_cancelled_consistent"),
        ),
    )
    op.create_index("ix_expenses_status_expense_date", "expenses", ["status", "expense_date"])
    _counter_check(True)
    op.execute("INSERT INTO document_counters (doc_type,last_number) VALUES ('expense',0)")
    for field in ("card_commission_bp", "tax_bp"):
        op.add_column(
            "business_settings",
            sa.Column(field, sa.Integer(), nullable=False, server_default=sa.text("0")),
        )
        op.create_check_constraint(
            op.f(f"ck_business_settings_{field}_range"),
            "business_settings",
            f"{field} BETWEEN 0 AND 10000",
        )


def downgrade() -> None:
    op.execute("""
        DO $$
        DECLARE expense_count bigint;
        BEGIN
            LOCK TABLE expenses IN ACCESS EXCLUSIVE MODE;
            SELECT count(*) INTO expense_count FROM expenses;
            IF expense_count > 0 THEN
                RAISE EXCEPTION USING MESSAGE =
                    'Откат миграции невозможен: найдено расходов: ' || expense_count ||
                    '. Откат с документами возможен только восстановлением ' ||
                    'из резервной копии (deploy/restore.sh)';
            END IF;
        END $$;
    """)
    op.drop_table("expenses")
    op.execute("DELETE FROM document_counters WHERE doc_type='expense'")
    _counter_check(False)
    for field in ("card_commission_bp", "tax_bp"):
        op.drop_constraint(
            op.f(f"ck_business_settings_{field}_range"), "business_settings", type_="check"
        )
        op.drop_column("business_settings", field)
