"""business settings

Revision ID: 381ee1812824
Revises: 977ec015efa6
Create Date: 2026-09-27 16:01:03.440463

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "381ee1812824"
down_revision: str | Sequence[str] | None = "977ec015efa6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _text_column(name: str) -> sa.Column:
    return sa.Column(name, sa.Text(), server_default=sa.text("''"), nullable=False)


def upgrade() -> None:
    """Single-row table with the seller details for invoices, created empty."""
    op.create_table(
        "business_settings",
        sa.Column("id", sa.SmallInteger(), autoincrement=False, nullable=False),
        _text_column("seller_name"),
        _text_column("seller_iin_bin"),
        _text_column("responsible_person"),
        _text_column("released_by_name"),
        _text_column("chief_accountant"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("id = 1", name=op.f("ck_business_settings_single_row")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_business_settings")),
    )
    op.execute("INSERT INTO business_settings (id) VALUES (1)")


def downgrade() -> None:
    op.drop_table("business_settings")
