"""enable pg_trgm extension

Revision ID: ea6fb7592287
Revises:
Create Date: 2026-09-26 22:23:40.654815

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ea6fb7592287"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")


def downgrade() -> None:
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
