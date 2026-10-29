from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Integer,
    SmallInteger,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

SETTINGS_ID = 1


def _text_column() -> Mapped[str]:
    return mapped_column(Text, server_default=text("''"))


class BusinessSettings(Base):
    """Seller details for the invoice (form З-2). The table always holds exactly one row, id = 1."""

    __tablename__ = "business_settings"
    __table_args__ = (
        CheckConstraint(
            "attention_markup_drop_points BETWEEN 1 AND 100",
            name="attention_markup_drop_points_range",
        ),
        CheckConstraint("attention_debt_days BETWEEN 1 AND 365", name="attention_debt_days_range"),
        CheckConstraint(
            "attention_frozen_days BETWEEN 30 AND 365", name="attention_frozen_days_range"
        ),
        CheckConstraint(
            "attention_runway_days BETWEEN 1 AND 180", name="attention_runway_days_range"
        ),
        CheckConstraint(
            "attention_discount_percent BETWEEN 1 AND 100", name="attention_discount_percent_range"
        ),
        CheckConstraint(
            "attention_loss_percent BETWEEN 1 AND 100", name="attention_loss_percent_range"
        ),
        CheckConstraint(f"id = {SETTINGS_ID}", name="single_row"),
        CheckConstraint("card_commission_bp BETWEEN 0 AND 10000", name="card_commission_bp_range"),
        CheckConstraint("tax_bp BETWEEN 0 AND 10000", name="tax_bp_range"),
        CheckConstraint(
            "rate_warning_percent BETWEEN 1 AND 100", name="rate_warning_percent_range"
        ),
    )

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, autoincrement=False)
    seller_name: Mapped[str] = _text_column()
    seller_iin_bin: Mapped[str] = _text_column()
    responsible_person: Mapped[str] = _text_column()
    released_by_name: Mapped[str] = _text_column()
    chief_accountant: Mapped[str] = _text_column()
    is_vat_payer: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    rate_warning_percent: Mapped[int] = mapped_column(Integer, server_default=text("10"))
    card_commission_bp: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    tax_bp: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    opening_balance_date: Mapped[date | None] = mapped_column(Date)
    attention_markup_drop_points: Mapped[int] = mapped_column(Integer, server_default=text("10"))
    attention_debt_days: Mapped[int] = mapped_column(Integer, server_default=text("30"))
    attention_frozen_days: Mapped[int] = mapped_column(Integer, server_default=text("90"))
    attention_runway_days: Mapped[int] = mapped_column(Integer, server_default=text("30"))
    attention_discount_percent: Mapped[int] = mapped_column(Integer, server_default=text("10"))
    attention_loss_percent: Mapped[int] = mapped_column(Integer, server_default=text("2"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
