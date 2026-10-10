"""Sale returns and their stock movement kinds.

Revision ID: 31a7d9e602bf
Revises: 2a7c9e41b603
"""

import sqlalchemy as sa
from alembic import op

revision = "31a7d9e602bf"
down_revision = "2a7c9e41b603"
branch_labels = None
depends_on = None


def _kinds(include_returns: bool) -> None:
    kinds = "'receipt', 'receipt_cancel', 'sale', 'sale_cancel', 'adjustment'"
    if include_returns:
        kinds += ", 'return', 'return_cancel'"
    op.drop_constraint(op.f("ck_stock_movements_kind_valid"), "stock_movements", type_="check")
    op.create_check_constraint(
        op.f("ck_stock_movements_kind_valid"), "stock_movements", f"kind IN ({kinds})"
    )


def _counter_check(include_returns: bool) -> None:
    types = "'receipt', 'sale', 'payment'" + (", 'return'" if include_returns else "")
    op.drop_constraint(
        op.f("ck_document_counters_doc_type_valid"), "document_counters", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_document_counters_doc_type_valid"), "document_counters", f"doc_type IN ({types})"
    )


def upgrade() -> None:
    op.create_table(
        "sale_returns",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("number", sa.BigInteger(), nullable=False),
        sa.Column("request_id", sa.UUID(), nullable=False),
        sa.Column("sale_id", sa.BigInteger(), nullable=False),
        sa.Column("customer_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "returned_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("total", sa.BigInteger(), nullable=False),
        sa.Column("debt_credit", sa.BigInteger(), nullable=False),
        sa.Column("refund_amount", sa.BigInteger(), nullable=False),
        sa.Column("refund_method", sa.Text(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
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
        sa.CheckConstraint("total >= 0", name=op.f("ck_sale_returns_total_non_negative")),
        sa.CheckConstraint(
            "debt_credit >= 0", name=op.f("ck_sale_returns_debt_credit_non_negative")
        ),
        sa.CheckConstraint(
            "refund_amount >= 0", name=op.f("ck_sale_returns_refund_amount_non_negative")
        ),
        sa.CheckConstraint(
            "debt_credit + refund_amount = total", name=op.f("ck_sale_returns_total_matches")
        ),
        sa.CheckConstraint(
            "refund_method IN ('cash', 'card')", name=op.f("ck_sale_returns_refund_method_valid")
        ),
        sa.CheckConstraint(
            "(refund_amount > 0) = (refund_method IS NOT NULL)",
            name=op.f("ck_sale_returns_refund_method_consistent"),
        ),
        sa.CheckConstraint(
            "customer_id IS NOT NULL OR debt_credit = 0",
            name=op.f("ck_sale_returns_credit_requires_customer"),
        ),
        sa.CheckConstraint(
            "status IN ('posted', 'cancelled')", name=op.f("ck_sale_returns_status_valid")
        ),
        sa.CheckConstraint(
            "(status = 'cancelled') = (cancelled_at IS NOT NULL)",
            name=op.f("ck_sale_returns_cancelled_consistent"),
        ),
        sa.ForeignKeyConstraint(["sale_id"], ["sales.id"]),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["cancelled_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("number"),
        sa.UniqueConstraint("request_id", name="uq_sale_returns_request_id"),
    )
    for column in ("sale_id", "customer_id", "returned_at"):
        op.create_index(f"ix_sale_returns_{column}", "sale_returns", [column])
    op.create_table(
        "sale_return_lines",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("return_id", sa.BigInteger(), nullable=False),
        sa.Column("sale_line_id", sa.BigInteger(), nullable=False),
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column("unit_price", sa.BigInteger(), nullable=False),
        sa.Column("line_total", sa.BigInteger(), nullable=False),
        sa.Column("unit_cost", sa.BigInteger(), nullable=True),
        sa.Column("condition", sa.Text(), nullable=False),
        sa.CheckConstraint("qty > 0", name=op.f("ck_sale_return_lines_qty_positive")),
        sa.CheckConstraint(
            "unit_price >= 0", name=op.f("ck_sale_return_lines_unit_price_non_negative")
        ),
        sa.CheckConstraint(
            "unit_cost >= 0", name=op.f("ck_sale_return_lines_unit_cost_non_negative")
        ),
        sa.CheckConstraint(
            "line_total = qty * unit_price", name=op.f("ck_sale_return_lines_line_total_matches")
        ),
        sa.CheckConstraint(
            "condition IN ('good', 'defective')", name=op.f("ck_sale_return_lines_condition_valid")
        ),
        sa.ForeignKeyConstraint(["return_id"], ["sale_returns.id"]),
        sa.ForeignKeyConstraint(["sale_line_id"], ["sale_lines.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("return_id", "sale_line_id"):
        op.create_index(f"ix_sale_return_lines_{column}", "sale_return_lines", [column])
    _kinds(True)
    _counter_check(True)
    op.execute("INSERT INTO document_counters (doc_type,last_number) VALUES ('return',0)")


def downgrade() -> None:
    # First command: serialize the guard with writers, before any schema changes.
    op.execute("""
        DO $$
        DECLARE return_count bigint;
        BEGIN
            LOCK TABLE sale_returns IN ACCESS EXCLUSIVE MODE;
            SELECT count(*) INTO return_count FROM sale_returns;
            IF return_count > 0 THEN
                RAISE EXCEPTION USING MESSAGE =
                    'Откат миграции невозможен: найдено возвратов: ' || return_count ||
                    '. Откат с возвратами возможен только восстановлением ' ||
                    'из резервной копии (deploy/restore.sh)';
            END IF;
        END $$;
    """)
    op.drop_table("sale_return_lines")
    op.drop_table("sale_returns")
    op.execute("DELETE FROM document_counters WHERE doc_type='return'")
    _counter_check(False)
    _kinds(False)
