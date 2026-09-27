from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, SmallInteger, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

SETTINGS_ID = 1


def _text_column() -> Mapped[str]:
    return mapped_column(Text, server_default=text("''"))


class BusinessSettings(Base):
    """Seller details for the invoice (form З-2). The table always holds exactly one row, id = 1."""

    __tablename__ = "business_settings"
    __table_args__ = (CheckConstraint(f"id = {SETTINGS_ID}", name="single_row"),)

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, autoincrement=False)
    seller_name: Mapped[str] = _text_column()
    seller_iin_bin: Mapped[str] = _text_column()
    responsible_person: Mapped[str] = _text_column()
    released_by_name: Mapped[str] = _text_column()
    chief_accountant: Mapped[str] = _text_column()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
