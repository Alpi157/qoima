"""Persist NBK rates by requested calendar date.

Revision ID: 8a4d2b731025
Revises: 7f3c8a921024
"""

import sqlalchemy as sa
from alembic import op

revision = "8a4d2b731025"
down_revision = "7f3c8a921024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "exchange_rates",
        sa.Column("rate_date", sa.Date(), nullable=False),
        sa.Column("currency", sa.Text(), nullable=False),
        sa.Column("rate", sa.Numeric(12, 4), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("published_date", sa.Date(), nullable=True),
        sa.Column(
            "fetched_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("rate_date", "currency"),
        sa.CheckConstraint("currency IN ('CNY', 'USD')", name="currency_valid"),
        sa.CheckConstraint("source = 'nbk'", name="source_valid"),
        sa.CheckConstraint("rate > 0 AND rate < 'Infinity'::numeric", name="rate_positive"),
    )


def downgrade() -> None:
    op.drop_table("exchange_rates")
