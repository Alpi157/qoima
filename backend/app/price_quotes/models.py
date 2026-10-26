from datetime import date, datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ProductPriceQuote(Base):
    __tablename__ = "product_price_quotes"
    __table_args__ = (
        CheckConstraint("currency IN ('KZT', 'CNY', 'USD')", name="currency_valid"),
        CheckConstraint("price_minor > 0", name="price_minor_positive"),
        CheckConstraint("status IN ('posted', 'cancelled')", name="status_valid"),
        CheckConstraint(
            "(status = 'cancelled') = (cancelled_at IS NOT NULL)", name="cancelled_consistent"
        ),
        Index(
            "ix_product_price_quotes_latest",
            "product_id",
            "status",
            "quoted_on",
            "created_at",
            "id",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    request_id: Mapped[UUID] = mapped_column(unique=True)
    product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id"))
    currency: Mapped[str] = mapped_column(Text)
    price_minor: Mapped[int] = mapped_column(BigInteger)
    quoted_on: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(Text, server_default=text("'posted'"))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    created_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
