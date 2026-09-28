"""user locale

Revision ID: 5c1f2a7d9e30
Revises: 381ee1812824
Create Date: 2026-09-28 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5c1f2a7d9e30"
down_revision: str | Sequence[str] | None = "381ee1812824"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Interface language of the user: kk, ru or zh; existing users get kk."""
    op.add_column(
        "users",
        sa.Column("locale", sa.Text(), server_default=sa.text("'kk'"), nullable=False),
    )
    op.create_check_constraint(
        op.f("ck_users_locale_supported"), "users", "locale IN ('kk', 'ru', 'zh')"
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_users_locale_supported"), "users", type_="check")
    op.drop_column("users", "locale")
