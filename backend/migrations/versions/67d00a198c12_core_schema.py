"""core schema

Revision ID: 67d00a198c12
Revises: ea6fb7592287
Create Date: 2026-09-27 08:51:36.962527

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "67d00a198c12"
down_revision: str | Sequence[str] | None = "ea6fb7592287"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("CREATE SEQUENCE receipt_number_seq")
    op.execute("CREATE SEQUENCE sale_number_seq")

    op.create_table(
        "customers",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("phone", sa.Text(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_customers")),
    )
    op.create_index(
        "ix_customers_name_lower_trgm",
        "customers",
        [sa.literal_column("lower(name) gin_trgm_ops")],
        unique=False,
        postgresql_using="gin",
    )
    op.create_table(
        "products",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("article", sa.Text(), nullable=False),
        sa.Column("article_norm", sa.Text(), nullable=False),
        sa.Column("brand", sa.Text(), nullable=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("unit", sa.Text(), server_default=sa.text("'шт'"), nullable=False),
        sa.Column("sale_price", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("is_archived", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("sale_price >= 0", name=op.f("ck_products_sale_price_non_negative")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_products")),
        sa.UniqueConstraint("article_norm", name=op.f("uq_products_article_norm")),
    )
    op.create_index(
        "ix_products_article_norm_trgm",
        "products",
        ["article_norm"],
        unique=False,
        postgresql_using="gin",
        postgresql_ops={"article_norm": "gin_trgm_ops"},
    )
    op.create_index(
        "ix_products_name_lower_trgm",
        "products",
        [sa.literal_column("lower(name) gin_trgm_ops")],
        unique=False,
        postgresql_using="gin",
    )
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("username", sa.Text(), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("full_name", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), server_default=sa.text("'owner'"), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("username", name=op.f("uq_users_username")),
    )
    op.create_table(
        "warehouses",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_warehouses")),
        sa.UniqueConstraint("code", name=op.f("uq_warehouses_code")),
    )
    op.create_table(
        "receipts",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column(
            "number",
            sa.BigInteger(),
            server_default=sa.text("nextval('receipt_number_seq')"),
            nullable=False,
        ),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("supplier", sa.Text(), nullable=True),
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
        sa.CheckConstraint(
            "(status = 'cancelled') = (cancelled_at IS NOT NULL)",
            name=op.f("ck_receipts_cancelled_consistent"),
        ),
        sa.CheckConstraint(
            "status IN ('posted', 'cancelled')", name=op.f("ck_receipts_status_valid")
        ),
        sa.ForeignKeyConstraint(
            ["cancelled_by"], ["users.id"], name=op.f("fk_receipts_cancelled_by_users")
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_receipts_created_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_receipts")),
        sa.UniqueConstraint("number", name=op.f("uq_receipts_number")),
    )
    op.create_index(op.f("ix_receipts_received_at"), "receipts", ["received_at"], unique=False)
    op.create_table(
        "sales",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column(
            "number",
            sa.BigInteger(),
            server_default=sa.text("nextval('sale_number_seq')"),
            nullable=False,
        ),
        sa.Column("request_id", sa.UUID(), nullable=False),
        sa.Column("customer_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "sold_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("total", sa.BigInteger(), nullable=False),
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
        sa.CheckConstraint(
            "(status = 'cancelled') = (cancelled_at IS NOT NULL)",
            name=op.f("ck_sales_cancelled_consistent"),
        ),
        sa.CheckConstraint("status IN ('posted', 'cancelled')", name=op.f("ck_sales_status_valid")),
        sa.CheckConstraint("total >= 0", name=op.f("ck_sales_total_non_negative")),
        sa.ForeignKeyConstraint(
            ["cancelled_by"], ["users.id"], name=op.f("fk_sales_cancelled_by_users")
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_sales_created_by_users")
        ),
        sa.ForeignKeyConstraint(
            ["customer_id"], ["customers.id"], name=op.f("fk_sales_customer_id_customers")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sales")),
        sa.UniqueConstraint("number", name=op.f("uq_sales_number")),
        sa.UniqueConstraint("request_id", name=op.f("uq_sales_request_id")),
    )
    op.create_index(op.f("ix_sales_customer_id"), "sales", ["customer_id"], unique=False)
    op.create_index(op.f("ix_sales_sold_at"), "sales", ["sold_at"], unique=False)
    op.create_table(
        "stock_balances",
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("warehouse_id", sa.BigInteger(), nullable=False),
        sa.Column("qty", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.CheckConstraint("qty >= 0", name=op.f("ck_stock_balances_qty_non_negative")),
        sa.ForeignKeyConstraint(
            ["product_id"], ["products.id"], name=op.f("fk_stock_balances_product_id_products")
        ),
        sa.ForeignKeyConstraint(
            ["warehouse_id"],
            ["warehouses.id"],
            name=op.f("fk_stock_balances_warehouse_id_warehouses"),
        ),
        sa.PrimaryKeyConstraint("product_id", "warehouse_id", name=op.f("pk_stock_balances")),
    )
    op.create_table(
        "stock_movements",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("warehouse_id", sa.BigInteger(), nullable=False),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("doc_type", sa.Text(), nullable=True),
        sa.Column("doc_id", sa.BigInteger(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('receipt', 'receipt_cancel', 'sale', 'sale_cancel', 'adjustment')",
            name=op.f("ck_stock_movements_kind_valid"),
        ),
        sa.CheckConstraint(
            "(doc_type IS NULL) = (doc_id IS NULL)",
            name=op.f("ck_stock_movements_doc_ref_complete"),
        ),
        sa.CheckConstraint("qty <> 0", name=op.f("ck_stock_movements_qty_non_zero")),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_stock_movements_created_by_users")
        ),
        sa.ForeignKeyConstraint(
            ["product_id"], ["products.id"], name=op.f("fk_stock_movements_product_id_products")
        ),
        sa.ForeignKeyConstraint(
            ["warehouse_id"],
            ["warehouses.id"],
            name=op.f("fk_stock_movements_warehouse_id_warehouses"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_stock_movements")),
    )
    op.create_index(
        "ix_stock_movements_product_id_created_at",
        "stock_movements",
        ["product_id", "created_at"],
        unique=False,
    )
    op.create_table(
        "user_sessions",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_user_sessions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_sessions")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_user_sessions_token_hash")),
    )
    op.create_index(op.f("ix_user_sessions_user_id"), "user_sessions", ["user_id"], unique=False)
    op.create_table(
        "receipt_lines",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("receipt_id", sa.BigInteger(), nullable=False),
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column("unit_cost", sa.BigInteger(), nullable=True),
        sa.CheckConstraint("qty > 0", name=op.f("ck_receipt_lines_qty_positive")),
        sa.CheckConstraint("unit_cost >= 0", name=op.f("ck_receipt_lines_unit_cost_non_negative")),
        sa.ForeignKeyConstraint(
            ["product_id"], ["products.id"], name=op.f("fk_receipt_lines_product_id_products")
        ),
        sa.ForeignKeyConstraint(
            ["receipt_id"], ["receipts.id"], name=op.f("fk_receipt_lines_receipt_id_receipts")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_receipt_lines")),
    )
    op.create_index(
        op.f("ix_receipt_lines_receipt_id"), "receipt_lines", ["receipt_id"], unique=False
    )
    op.create_table(
        "sale_lines",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("sale_id", sa.BigInteger(), nullable=False),
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column("unit_price", sa.BigInteger(), nullable=False),
        sa.Column("line_total", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("line_total >= 0", name=op.f("ck_sale_lines_line_total_non_negative")),
        sa.CheckConstraint(
            "line_total = qty * unit_price", name=op.f("ck_sale_lines_line_total_matches")
        ),
        sa.CheckConstraint("qty > 0", name=op.f("ck_sale_lines_qty_positive")),
        sa.CheckConstraint("unit_price >= 0", name=op.f("ck_sale_lines_unit_price_non_negative")),
        sa.ForeignKeyConstraint(
            ["product_id"], ["products.id"], name=op.f("fk_sale_lines_product_id_products")
        ),
        sa.ForeignKeyConstraint(
            ["sale_id"], ["sales.id"], name=op.f("fk_sale_lines_sale_id_sales")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sale_lines")),
    )
    op.create_index(op.f("ix_sale_lines_sale_id"), "sale_lines", ["sale_id"], unique=False)

    op.execute(
        """
        CREATE FUNCTION stock_movements_forbid_change() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'stock_movements is append-only: % is not allowed', TG_OP;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER stock_movements_append_only
        BEFORE UPDATE OR DELETE OR TRUNCATE ON stock_movements
        FOR EACH STATEMENT EXECUTE FUNCTION stock_movements_forbid_change()
        """
    )

    op.execute("INSERT INTO warehouses (code, name) VALUES ('main', 'Основной')")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP TRIGGER stock_movements_append_only ON stock_movements")
    op.execute("DROP FUNCTION stock_movements_forbid_change()")

    op.drop_index(op.f("ix_sale_lines_sale_id"), table_name="sale_lines")
    op.drop_table("sale_lines")
    op.drop_index(op.f("ix_receipt_lines_receipt_id"), table_name="receipt_lines")
    op.drop_table("receipt_lines")
    op.drop_index(op.f("ix_user_sessions_user_id"), table_name="user_sessions")
    op.drop_table("user_sessions")
    op.drop_index("ix_stock_movements_product_id_created_at", table_name="stock_movements")
    op.drop_table("stock_movements")
    op.drop_table("stock_balances")
    op.drop_index(op.f("ix_sales_sold_at"), table_name="sales")
    op.drop_index(op.f("ix_sales_customer_id"), table_name="sales")
    op.drop_table("sales")
    op.drop_index(op.f("ix_receipts_received_at"), table_name="receipts")
    op.drop_table("receipts")
    op.drop_table("warehouses")
    op.drop_table("users")
    op.drop_index("ix_products_name_lower_trgm", table_name="products", postgresql_using="gin")
    op.drop_index(
        "ix_products_article_norm_trgm",
        table_name="products",
        postgresql_using="gin",
        postgresql_ops={"article_norm": "gin_trgm_ops"},
    )
    op.drop_table("products")
    op.drop_index("ix_customers_name_lower_trgm", table_name="customers", postgresql_using="gin")
    op.drop_table("customers")

    op.execute("DROP SEQUENCE sale_number_seq")
    op.execute("DROP SEQUENCE receipt_number_seq")
