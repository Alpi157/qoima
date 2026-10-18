"""Receipt rate warning threshold.

Revision ID: ac6d7e921026
Revises: 9b5e3c841026
"""

import sqlalchemy as sa
from alembic import op

revision = "ac6d7e921026"
down_revision = "9b5e3c841026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "business_settings",
        sa.Column("rate_warning_percent", sa.Integer(), nullable=False, server_default="10"),
    )
    op.create_check_constraint(
        "rate_warning_percent_range", "business_settings", "rate_warning_percent BETWEEN 1 AND 100"
    )


def downgrade() -> None:
    op.drop_column("business_settings", "rate_warning_percent")
