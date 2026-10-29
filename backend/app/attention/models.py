from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AttentionDismissal(Base):
    __tablename__ = "attention_dismissals"
    key: Mapped[str] = mapped_column(Text, primary_key=True)
    hidden_until: Mapped[date] = mapped_column(Date)
    created_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
