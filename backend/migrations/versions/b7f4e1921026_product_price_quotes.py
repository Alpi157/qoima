"""Supplier price quotes for replacement valuation.

Revision ID: b7f4e1921026
Revises: ac6d7e921026
"""

import sqlalchemy as sa
from alembic import op

revision = "b7f4e1921026"
down_revision = "ac6d7e921026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "product_price_quotes",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("request_id", sa.UUID(), nullable=False, unique=True),
        sa.Column("product_id", sa.BigInteger(), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("currency", sa.Text(), nullable=False),
        sa.Column("price_minor", sa.BigInteger(), nullable=False),
        sa.Column("quoted_on", sa.Date(), nullable=False),
        sa.Column("status", sa.Text(), server_default=sa.text("'posted'"), nullable=False),
        sa.Column("cancelled_at", sa.DateTime(timezone=True)),
        sa.Column("cancelled_by", sa.BigInteger(), sa.ForeignKey("users.id")),
        sa.Column("created_by", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "currency IN ('KZT', 'CNY', 'USD')", name=op.f("ck_product_price_quotes_currency_valid")
        ),
        sa.CheckConstraint(
            "price_minor > 0", name=op.f("ck_product_price_quotes_price_minor_positive")
        ),
        sa.CheckConstraint(
            "status IN ('posted', 'cancelled')", name=op.f("ck_product_price_quotes_status_valid")
        ),
        sa.CheckConstraint(
            "(status = 'cancelled') = (cancelled_at IS NOT NULL)",
            name=op.f("ck_product_price_quotes_cancelled_consistent"),
        ),
    )
    op.create_index(
        "ix_product_price_quotes_latest",
        "product_price_quotes",
        ["product_id", "status", "quoted_on", "created_at", "id"],
    )


def downgrade() -> None:
    op.execute("""
        DO $$
        DECLARE quote_count bigint;
        BEGIN
            LOCK TABLE product_price_quotes IN ACCESS EXCLUSIVE MODE;
            SELECT count(*) INTO quote_count FROM product_price_quotes;
            IF quote_count > 0 THEN
                RAISE EXCEPTION USING MESSAGE =
                    'Откат миграции невозможен: найдено цен поставщика: ' || quote_count ||
                    '. Откат с документами возможен только восстановлением ' ||
                    'из резервной копии (deploy/restore.sh)';
            END IF;
        END $$;
    """)
    op.drop_table("product_price_quotes")
