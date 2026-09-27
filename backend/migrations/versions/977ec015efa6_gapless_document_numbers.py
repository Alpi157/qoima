"""gapless document numbers

Revision ID: 977ec015efa6
Revises: 67d00a198c12
Create Date: 2026-09-27 13:10:56.511873

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "977ec015efa6"
down_revision: str | Sequence[str] | None = "67d00a198c12"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (doc_type, table, sequence the numbers came from before this revision)
NUMBERED = [("receipt", "receipts", "receipt_number_seq"), ("sale", "sales", "sale_number_seq")]


def upgrade() -> None:
    """Replace number sequences with a transactional counter table."""
    op.create_table(
        "document_counters",
        sa.Column("doc_type", sa.Text(), nullable=False),
        sa.Column("last_number", sa.BigInteger(), nullable=False),
        sa.CheckConstraint(
            "doc_type IN ('receipt', 'sale')", name=op.f("ck_document_counters_doc_type_valid")
        ),
        sa.CheckConstraint(
            "last_number >= 0", name=op.f("ck_document_counters_last_number_non_negative")
        ),
        sa.PrimaryKeyConstraint("doc_type", name=op.f("pk_document_counters")),
    )
    for doc_type, table, sequence in NUMBERED:
        op.execute(
            f"INSERT INTO document_counters (doc_type, last_number) "
            f"SELECT '{doc_type}', COALESCE(MAX(number), 0) FROM {table}"
        )
        op.alter_column(table, "number", server_default=None)
        op.execute(f"DROP SEQUENCE {sequence}")


def downgrade() -> None:
    """Restore the sequences, continuing after the current maximum number."""
    for _doc_type, table, sequence in NUMBERED:
        op.execute(f"CREATE SEQUENCE {sequence}")
        # With no documents the next nextval() returns 1.
        op.execute(
            f"SELECT setval('{sequence}', COALESCE(MAX(number), 1), MAX(number) IS NOT NULL) "
            f"FROM {table}"
        )
        op.alter_column(table, "number", server_default=sa.text(f"nextval('{sequence}')"))
    op.drop_table("document_counters")
