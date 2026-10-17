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


class Sale(Base):
    __tablename__ = "sales"
    __table_args__ = (
        CheckConstraint("total >= 0", name="total_non_negative"),
        CheckConstraint("payment_method IN ('cash', 'card')", name="payment_method_valid"),
        CheckConstraint(
            "(paid_at_sale > 0) = (payment_method IS NOT NULL)", name="payment_method_consistent"
        ),
        CheckConstraint("paid_at_sale >= 0 AND paid_at_sale <= total", name="paid_at_sale_range"),
        CheckConstraint(
            "paid_at_sale = total OR customer_id IS NOT NULL", name="debt_requires_customer"
        ),
        CheckConstraint("status IN ('posted', 'cancelled')", name="status_valid"),
        CheckConstraint(
            "(status = 'cancelled') = (cancelled_at IS NOT NULL)", name="cancelled_consistent"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    # Gapless, taken from document_counters by app.numbering.next_number.
    number: Mapped[int] = mapped_column(BigInteger, unique=True)
    request_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), unique=True)
    customer_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("customers.id"), index=True
    )
    customer_name: Mapped[str | None] = mapped_column(Text)
    customer_phone: Mapped[str | None] = mapped_column(Text)
    seller_name: Mapped[str] = mapped_column(Text)
    seller_iin_bin: Mapped[str] = mapped_column(Text)
    responsible_person: Mapped[str] = mapped_column(Text)
    released_by_name: Mapped[str] = mapped_column(Text)
    chief_accountant: Mapped[str] = mapped_column(Text)
    sold_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    total: Mapped[int] = mapped_column(BigInteger)
    paid_at_sale: Mapped[int] = mapped_column(BigInteger)
    payment_method: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default=text("'posted'"))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    cancel_reason: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SaleLine(Base):
    __tablename__ = "sale_lines"
    __table_args__ = (
        CheckConstraint("qty > 0", name="qty_positive"),
        CheckConstraint("unit_price >= 0", name="unit_price_non_negative"),
        CheckConstraint("list_price >= 0", name="list_price_non_negative"),
        CheckConstraint("unit_cost >= 0", name="unit_cost_non_negative"),
        CheckConstraint("line_total >= 0", name="line_total_non_negative"),
        CheckConstraint("line_total = qty * unit_price", name="line_total_matches"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    sale_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("sales.id"), index=True)
    product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id"))
    article: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    unit: Mapped[str] = mapped_column(Text)
    list_price: Mapped[int | None] = mapped_column(BigInteger)
    qty: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[int] = mapped_column(BigInteger)
    unit_cost: Mapped[int | None] = mapped_column(BigInteger)
    line_total: Mapped[int] = mapped_column(BigInteger)
