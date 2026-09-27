from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Identity,
    Index,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint("sale_price >= 0", name="sale_price_non_negative"),
        Index(
            "ix_products_article_norm_trgm",
            "article_norm",
            postgresql_using="gin",
            postgresql_ops={"article_norm": "gin_trgm_ops"},
        ),
        Index(
            "ix_products_name_lower_trgm",
            text("lower(name) gin_trgm_ops"),
            postgresql_using="gin",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    article: Mapped[str] = mapped_column(Text)
    article_norm: Mapped[str] = mapped_column(Text, unique=True)
    brand: Mapped[str | None] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    unit: Mapped[str] = mapped_column(Text, server_default=text("'шт'"))
    sale_price: Mapped[int] = mapped_column(BigInteger, server_default=text("0"))
    note: Mapped[str | None] = mapped_column(Text)
    is_archived: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
