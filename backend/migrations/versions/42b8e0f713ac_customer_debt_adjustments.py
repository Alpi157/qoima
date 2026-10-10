"""Customer debt adjustments.

Revision ID: 42b8e0f713ac
Revises: 31a7d9e602bf
"""

import sqlalchemy as sa
from alembic import op

revision = "42b8e0f713ac"
down_revision = "31a7d9e602bf"
branch_labels = None
depends_on = None


def _counter_check(include_adjustments: bool) -> None:
    types = "'receipt', 'sale', 'payment', 'return'"
    if include_adjustments:
        types += ", 'debt_adjustment'"
    op.drop_constraint(
        op.f("ck_document_counters_doc_type_valid"), "document_counters", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_document_counters_doc_type_valid"), "document_counters", f"doc_type IN ({types})"
    )


def upgrade() -> None:
    op.create_table(
        "customer_debt_adjustments",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("number", sa.BigInteger(), nullable=False),
        sa.Column("request_id", sa.UUID(), nullable=False),
        sa.Column("customer_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "adjusted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), server_default=sa.text("'posted'"), nullable=False),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_by", sa.BigInteger(), nullable=True),
        sa.Column("cancel_reason", sa.Text(), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("amount <> 0", name=op.f("ck_customer_debt_adjustments_amount_nonzero")),
        sa.CheckConstraint(
            "btrim(reason) <> ''", name=op.f("ck_customer_debt_adjustments_reason_nonempty")
        ),
        sa.CheckConstraint(
            "status IN ('posted', 'cancelled')",
            name=op.f("ck_customer_debt_adjustments_status_valid"),
        ),
        sa.CheckConstraint(
            "(status = 'cancelled') = (cancelled_at IS NOT NULL)",
            name=op.f("ck_customer_debt_adjustments_cancelled_consistent"),
        ),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["cancelled_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("number"),
        sa.UniqueConstraint("request_id"),
    )
    for column in ("customer_id", "adjusted_at"):
        op.create_index(
            f"ix_customer_debt_adjustments_{column}", "customer_debt_adjustments", [column]
        )
    _counter_check(True)
    op.execute("INSERT INTO document_counters (doc_type,last_number) VALUES ('debt_adjustment',0)")


def downgrade() -> None:
    # Serialize the guard with writers before changing any schema or counters.
    op.execute("""
        DO $$
        DECLARE adjustment_count bigint;
        BEGIN
            LOCK TABLE customer_debt_adjustments IN ACCESS EXCLUSIVE MODE;
            SELECT count(*) INTO adjustment_count FROM customer_debt_adjustments;
            IF adjustment_count > 0 THEN
                RAISE EXCEPTION USING MESSAGE =
                    'Откат миграции невозможен: найдено исправлений долга: ' || adjustment_count ||
                    '. Откат с документами возможен только восстановлением ' ||
                    'из резервной копии (deploy/restore.sh)';
            END IF;
        END $$;
    """)
    op.drop_table("customer_debt_adjustments")
    op.execute("DELETE FROM document_counters WHERE doc_type='debt_adjustment'")
    _counter_check(False)
