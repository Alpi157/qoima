from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, DateTime, Numeric, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ExchangeRate(Base):
    __tablename__ = "exchange_rates"
    __table_args__ = (
        CheckConstraint("currency IN ('CNY', 'USD')", name="currency_valid"),
        CheckConstraint("source = 'nbk'", name="source_valid"),
        CheckConstraint("rate > 0 AND rate < 'Infinity'::numeric", name="rate_positive"),
    )

    rate_date: Mapped[date] = mapped_column(Date, primary_key=True)
    currency: Mapped[str] = mapped_column(Text, primary_key=True)
    rate: Mapped[Decimal] = mapped_column(Numeric(12, 4))
    source: Mapped[str] = mapped_column(Text)
    published_date: Mapped[date | None] = mapped_column(Date)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
