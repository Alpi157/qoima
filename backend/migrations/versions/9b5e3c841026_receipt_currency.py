"""Currency receipts and persisted expense allocations.

Revision ID: 9b5e3c841026
Revises: 8a4d2b731025
"""

import sqlalchemy as sa
from alembic import op

revision = "9b5e3c841026"
down_revision = "8a4d2b731025"
branch_labels = None
depends_on = None


def _currency_checks(table: str) -> None:
    op.create_check_constraint("currency_valid", table, "currency IN ('KZT', 'CNY', 'USD')")
    op.create_check_constraint(
        "exchange_rate_positive",
        table,
        "exchange_rate > 0 AND exchange_rate < 'Infinity'::numeric",
    )
    op.create_check_constraint(
        "currency_rate_consistent",
        table,
        "(currency = 'KZT' AND exchange_rate = 1 "
        "AND rate_date IS NULL AND rate_source IS NULL) OR "
        "(currency IN ('CNY', 'USD') AND rate_date IS NOT NULL "
        "AND rate_source IS NOT NULL AND rate_source IN ('nbk', 'manual'))",
    )


def upgrade() -> None:
    op.add_column(
        "receipts", sa.Column("currency", sa.Text(), nullable=False, server_default="KZT")
    )
    op.add_column(
        "receipts",
        sa.Column(
            "exchange_rate",
            sa.Numeric(12, 4),
            nullable=False,
            server_default="1",
        ),
    )
    op.add_column("receipts", sa.Column("rate_date", sa.Date(), nullable=True))
    op.add_column("receipts", sa.Column("rate_source", sa.Text(), nullable=True))
    op.add_column(
        "receipts",
        sa.Column(
            "vat_payer_snapshot",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    _currency_checks("receipts")
    op.add_column("receipt_lines", sa.Column("unit_price_minor", sa.BigInteger(), nullable=True))
    op.add_column("receipt_lines", sa.Column("goods_total", sa.BigInteger(), nullable=True))
    op.add_column(
        "receipt_lines",
        sa.Column(
            "expenses_total",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
        ),
    )
    op.execute("""
        UPDATE receipt_lines SET unit_price_minor = unit_cost, goods_total = qty * unit_cost
        WHERE unit_cost IS NOT NULL
    """)
    for column in ("unit_price_minor", "goods_total", "expenses_total"):
        op.create_check_constraint(f"{column}_non_negative", "receipt_lines", f"{column} >= 0")
    op.create_check_constraint(
        "price_consistent",
        "receipt_lines",
        "(unit_price_minor IS NULL AND goods_total IS NULL AND unit_cost IS NULL) OR "
        "(unit_price_minor IS NOT NULL AND goods_total IS NOT NULL AND unit_cost IS NOT NULL)",
    )
    op.create_table(
        "receipt_expenses",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("receipt_id", sa.BigInteger(), sa.ForeignKey("receipts.id"), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.Text(), nullable=False),
        sa.Column("exchange_rate", sa.Numeric(12, 4), nullable=False),
        sa.Column("rate_date", sa.Date(), nullable=True),
        sa.Column("rate_source", sa.Text(), nullable=True),
        sa.Column("amount_tiyn", sa.BigInteger(), nullable=False),
        sa.Column("allocation_method", sa.Text(), nullable=False, server_default="amount"),
        sa.Column("is_vat_credit", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("revaluation_currency", sa.Text(), nullable=True),
        sa.Column("revaluation_rate", sa.Numeric(12, 4), nullable=True),
        sa.CheckConstraint(
            "kind IN ('delivery', 'customs_duty', 'antidumping_duty', 'import_vat', "
            "'broker', 'bank', 'other')",
            name="kind_valid",
        ),
        sa.CheckConstraint("amount_minor > 0", name="amount_minor_positive"),
        sa.CheckConstraint("amount_tiyn >= 0", name="amount_tiyn_non_negative"),
        sa.CheckConstraint(
            "allocation_method IN ('amount', 'quantity', 'selected', 'manual')",
            name="allocation_method_valid",
        ),
        sa.CheckConstraint("NOT is_vat_credit OR kind = 'import_vat'", name="vat_credit_valid"),
        sa.CheckConstraint(
            "revaluation_currency IN ('CNY', 'USD')",
            name="revaluation_currency_valid",
        ),
        sa.CheckConstraint(
            "revaluation_rate > 0 AND revaluation_rate < 'Infinity'::numeric",
            name="revaluation_rate_positive",
        ),
        sa.CheckConstraint(
            "(revaluation_currency IS NULL AND revaluation_rate IS NULL) OR "
            "(revaluation_currency IS NOT NULL AND revaluation_rate IS NOT NULL)",
            name="revaluation_consistent",
        ),
    )
    _currency_checks("receipt_expenses")
    op.create_index("ix_receipt_expenses_receipt_id", "receipt_expenses", ["receipt_id"])
    op.create_table(
        "receipt_expense_allocations",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "expense_id", sa.BigInteger(), sa.ForeignKey("receipt_expenses.id"), nullable=False
        ),
        sa.Column(
            "receipt_line_id", sa.BigInteger(), sa.ForeignKey("receipt_lines.id"), nullable=False
        ),
        sa.Column("amount_tiyn", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("amount_tiyn >= 0", name="amount_tiyn_non_negative"),
        sa.UniqueConstraint("expense_id", "receipt_line_id"),
    )
    for column in ("expense_id", "receipt_line_id"):
        op.create_index(
            f"ix_receipt_expense_allocations_{column}",
            "receipt_expense_allocations",
            [column],
        )
    op.add_column(
        "business_settings",
        sa.Column(
            "is_vat_payer",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.execute("""
        DO $$
        DECLARE receipt_count bigint; expense_count bigint;
        BEGIN
            LOCK TABLE receipts, receipt_expenses IN ACCESS EXCLUSIVE MODE;
            SELECT count(*) INTO receipt_count FROM receipts WHERE currency <> 'KZT';
            SELECT count(*) INTO expense_count FROM receipt_expenses;
            IF receipt_count > 0 OR expense_count > 0 THEN
                RAISE EXCEPTION USING MESSAGE =
                    'Откат миграции невозможен: валютных приходов: ' || receipt_count ||
                    ', расходов: ' || expense_count ||
                    '. Откат с такими документами возможен только восстановлением ' ||
                    'из резервной копии (deploy/restore.sh)';
            END IF;
        END $$;
    """)
    op.drop_column("business_settings", "is_vat_payer")
    op.drop_table("receipt_expense_allocations")
    op.drop_table("receipt_expenses")
    op.drop_constraint(op.f("ck_receipt_lines_price_consistent"), "receipt_lines", type_="check")
    for column in ("expenses_total", "goods_total", "unit_price_minor"):
        op.drop_constraint(
            op.f(f"ck_receipt_lines_{column}_non_negative"), "receipt_lines", type_="check"
        )
        op.drop_column("receipt_lines", column)
    for name in ("currency_rate_consistent", "exchange_rate_positive", "currency_valid"):
        op.drop_constraint(op.f(f"ck_receipts_{name}"), "receipts", type_="check")
    for column in ("vat_payer_snapshot", "rate_source", "rate_date", "exchange_rate", "currency"):
        op.drop_column("receipts", column)
