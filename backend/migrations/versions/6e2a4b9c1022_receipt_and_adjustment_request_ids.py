"""Idempotency keys for receipts and manual stock adjustments.

Revision ID: 6e2a4b9c1022
Revises: 42b8e0f713ac
"""

import sqlalchemy as sa
from alembic import op

revision = "6e2a4b9c1022"
down_revision = "42b8e0f713ac"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("receipts", sa.Column("request_id", sa.UUID(), nullable=True))
    op.create_unique_constraint("uq_receipts_request_id", "receipts", ["request_id"])
    op.add_column("stock_movements", sa.Column("request_id", sa.UUID(), nullable=True))
    op.create_index(
        "uq_stock_movements_request_id",
        "stock_movements",
        ["request_id"],
        unique=True,
        postgresql_where=sa.text("request_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.execute("""
        DO $$
        DECLARE receipt_count bigint; movement_count bigint;
        BEGIN
            LOCK TABLE receipts, stock_movements IN ACCESS EXCLUSIVE MODE;
            SELECT count(*) INTO receipt_count FROM receipts WHERE request_id IS NOT NULL;
            SELECT count(*) INTO movement_count
                FROM stock_movements WHERE request_id IS NOT NULL;
            IF receipt_count > 0 OR movement_count > 0 THEN
                RAISE EXCEPTION USING MESSAGE =
                    'Откат миграции невозможен: найдены request_id у приёмов: ' || receipt_count ||
                    ', у движений: ' || movement_count ||
                    '. Откат с такими документами возможен только восстановлением ' ||
                    'из резервной копии (deploy/restore.sh)';
            END IF;
        END $$;
    """)
    op.drop_index("uq_stock_movements_request_id", table_name="stock_movements")
    op.drop_column("stock_movements", "request_id")
    op.drop_constraint("uq_receipts_request_id", "receipts", type_="unique")
    op.drop_column("receipts", "request_id")
