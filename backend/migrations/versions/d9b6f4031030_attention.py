"""Attention thresholds, opening balances and dismissals."""

import sqlalchemy as sa
from alembic import op

revision = "d9b6f4031030"
down_revision = "c8a5e3921029"
branch_labels = None
depends_on = None
FIELDS = [
    ("markup_drop_points", 10, 1, 100),
    ("debt_days", 30, 1, 365),
    ("frozen_days", 90, 30, 365),
    ("runway_days", 30, 1, 180),
    ("discount_percent", 10, 1, 100),
    ("loss_percent", 2, 1, 100),
]


def upgrade():
    op.add_column("business_settings", sa.Column("opening_balance_date", sa.Date(), nullable=True))
    for name, default, low, high in FIELDS:
        field = "attention_" + name
        op.add_column(
            "business_settings",
            sa.Column(field, sa.Integer(), nullable=False, server_default=sa.text(str(default))),
        )
        op.create_check_constraint(
            op.f(f"ck_business_settings_{field}_range"),
            "business_settings",
            f"{field} BETWEEN {low} AND {high}",
        )
    op.create_table(
        "attention_dismissals",
        sa.Column("key", sa.Text(), primary_key=True),
        sa.Column("hidden_until", sa.Date(), nullable=False),
        sa.Column("created_by", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )


def downgrade():
    op.execute("""
    DO $$ BEGIN
      LOCK TABLE attention_dismissals, business_settings IN ACCESS EXCLUSIVE MODE;
      IF EXISTS (SELECT 1 FROM attention_dismissals) THEN
        RAISE EXCEPTION 'Откат миграции невозможен: найдены скрытия сигналов';
      END IF;
      IF EXISTS (SELECT 1 FROM business_settings WHERE opening_balance_date IS NOT NULL) THEN
        RAISE EXCEPTION 'Откат миграции невозможен: задана дата начала учёта';
      END IF;
    END $$;
    """)
    op.drop_table("attention_dismissals")
    for name, _, _, _ in FIELDS:
        field = "attention_" + name
        op.drop_constraint(
            op.f(f"ck_business_settings_{field}_range"), "business_settings", type_="check"
        )
        op.drop_column("business_settings", field)
    op.drop_column("business_settings", "opening_balance_date")
