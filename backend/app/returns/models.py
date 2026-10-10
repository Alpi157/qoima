import uuid
from datetime import datetime

from sqlalchemy import (
    UUID,
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class SaleReturn(Base):
    __tablename__ = "sale_returns"
    __table_args__ = (
        CheckConstraint("total >= 0", name="total_non_negative"),
        CheckConstraint("debt_credit >= 0", name="debt_credit_non_negative"),
        CheckConstraint("refund_amount >= 0", name="refund_amount_non_negative"),
        CheckConstraint("debt_credit + refund_amount = total", name="total_matches"),
        CheckConstraint("refund_method IN ('cash', 'card')", name="refund_method_valid"),
        CheckConstraint(
            "(refund_amount > 0) = (refund_method IS NOT NULL)", name="refund_method_consistent"
        ),
        CheckConstraint(
            "customer_id IS NOT NULL OR debt_credit = 0", name="credit_requires_customer"
        ),
        CheckConstraint("status IN ('posted', 'cancelled')", name="status_valid"),
        CheckConstraint(
            "(status = 'cancelled') = (cancelled_at IS NOT NULL)", name="cancelled_consistent"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    number: Mapped[int] = mapped_column(BigInteger, unique=True)
    request_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), unique=True)
    sale_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("sales.id"), index=True)
    customer_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("customers.id"), index=True
    )
    returned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    total: Mapped[int] = mapped_column(BigInteger)
    debt_credit: Mapped[int] = mapped_column(BigInteger)
    refund_amount: Mapped[int] = mapped_column(BigInteger)
    refund_method: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default=text("'posted'"))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    cancel_reason: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SaleReturnLine(Base):
    __tablename__ = "sale_return_lines"
    __table_args__ = (
        CheckConstraint("qty > 0", name="qty_positive"),
        CheckConstraint("unit_price >= 0", name="unit_price_non_negative"),
        CheckConstraint("unit_cost >= 0", name="unit_cost_non_negative"),
        CheckConstraint("line_total = qty * unit_price", name="line_total_matches"),
        CheckConstraint("condition IN ('good', 'defective')", name="condition_valid"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    return_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("sale_returns.id"), index=True)
    sale_line_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("sale_lines.id"), index=True)
    product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id"))
    qty: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[int] = mapped_column(BigInteger)
    line_total: Mapped[int] = mapped_column(BigInteger)
    unit_cost: Mapped[int | None] = mapped_column(BigInteger)
    condition: Mapped[str] = mapped_column(Text)
