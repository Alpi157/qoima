from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

MAIN_WAREHOUSE_CODE = "main"

MOVEMENT_KINDS = ("receipt", "receipt_cancel", "sale", "sale_cancel", "adjustment")


class Warehouse(Base):
    __tablename__ = "warehouses"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    code: Mapped[str] = mapped_column(Text, unique=True)
    name: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StockMovement(Base):
    __tablename__ = "stock_movements"
    __table_args__ = (
        CheckConstraint("qty <> 0", name="qty_non_zero"),
        CheckConstraint(
            "kind IN (" + ", ".join(f"'{k}'" for k in MOVEMENT_KINDS) + ")",
            name="kind_valid",
        ),
        CheckConstraint("(doc_type IS NULL) = (doc_id IS NULL)", name="doc_ref_complete"),
        Index("ix_stock_movements_product_id_created_at", "product_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id"))
    warehouse_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("warehouses.id"))
    qty: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(Text)
    doc_type: Mapped[str | None] = mapped_column(Text)
    doc_id: Mapped[int | None] = mapped_column(BigInteger)
    note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StockBalance(Base):
    __tablename__ = "stock_balances"
    __table_args__ = (CheckConstraint("qty >= 0", name="qty_non_negative"),)

    product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id"), primary_key=True)
    warehouse_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("warehouses.id"), primary_key=True
    )
    qty: Mapped[int] = mapped_column(Integer, server_default=text("0"))
