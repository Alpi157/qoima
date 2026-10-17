from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _currency_constraints() -> tuple[CheckConstraint, ...]:
    return (
        CheckConstraint("currency IN ('KZT', 'CNY', 'USD')", name="currency_valid"),
        CheckConstraint(
            "exchange_rate > 0 AND exchange_rate < 'Infinity'::numeric",
            name="exchange_rate_positive",
        ),
        CheckConstraint(
            "(currency = 'KZT' AND exchange_rate = 1 "
            "AND rate_date IS NULL AND rate_source IS NULL) OR "
            "(currency IN ('CNY', 'USD') AND rate_date IS NOT NULL "
            "AND rate_source IS NOT NULL AND rate_source IN ('nbk', 'manual'))",
            name="currency_rate_consistent",
        ),
    )


class Receipt(Base):
    __tablename__ = "receipts"
    __table_args__ = (
        *_currency_constraints(),
        CheckConstraint("status IN ('posted', 'cancelled')", name="status_valid"),
        CheckConstraint(
            "(status = 'cancelled') = (cancelled_at IS NOT NULL)", name="cancelled_consistent"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    # Gapless, taken from document_counters by app.numbering.next_number.
    number: Mapped[int] = mapped_column(BigInteger, unique=True)
    request_id: Mapped[UUID | None] = mapped_column(unique=True)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    supplier: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    currency: Mapped[str] = mapped_column(Text, server_default=text("'KZT'"))
    exchange_rate: Mapped[Decimal] = mapped_column(Numeric(12, 4), server_default=text("1"))
    rate_date: Mapped[date | None] = mapped_column(Date)
    rate_source: Mapped[str | None] = mapped_column(Text)
    vat_payer_snapshot: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    status: Mapped[str] = mapped_column(Text, server_default=text("'posted'"))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    cancel_reason: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ReceiptLine(Base):
    __tablename__ = "receipt_lines"
    __table_args__ = (
        CheckConstraint("qty > 0", name="qty_positive"),
        CheckConstraint("unit_cost >= 0", name="unit_cost_non_negative"),
        CheckConstraint("unit_price_minor >= 0", name="unit_price_minor_non_negative"),
        CheckConstraint("goods_total >= 0", name="goods_total_non_negative"),
        CheckConstraint("expenses_total >= 0", name="expenses_total_non_negative"),
        CheckConstraint(
            "(unit_price_minor IS NULL AND goods_total IS NULL AND unit_cost IS NULL) OR "
            "(unit_price_minor IS NOT NULL AND goods_total IS NOT NULL AND unit_cost IS NOT NULL)",
            name="price_consistent",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    receipt_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("receipts.id"), index=True)
    product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id"))
    article: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    unit: Mapped[str] = mapped_column(Text)
    qty: Mapped[int] = mapped_column(Integer)
    unit_cost: Mapped[int | None] = mapped_column(BigInteger)
    unit_price_minor: Mapped[int | None] = mapped_column(BigInteger)
    goods_total: Mapped[int | None] = mapped_column(BigInteger)
    expenses_total: Mapped[int] = mapped_column(BigInteger, server_default=text("0"))


class ReceiptExpense(Base):
    __tablename__ = "receipt_expenses"
    __table_args__ = (
        *_currency_constraints(),
        CheckConstraint(
            "kind IN ('delivery', 'customs_duty', 'antidumping_duty', 'import_vat', "
            "'broker', 'bank', 'other')",
            name="kind_valid",
        ),
        CheckConstraint("amount_minor > 0", name="amount_minor_positive"),
        CheckConstraint("amount_tiyn >= 0", name="amount_tiyn_non_negative"),
        CheckConstraint(
            "allocation_method IN ('amount', 'quantity', 'selected', 'manual')",
            name="allocation_method_valid",
        ),
        CheckConstraint("NOT is_vat_credit OR kind = 'import_vat'", name="vat_credit_valid"),
        CheckConstraint(
            "revaluation_currency IN ('CNY', 'USD')", name="revaluation_currency_valid"
        ),
        CheckConstraint(
            "revaluation_rate > 0 AND revaluation_rate < 'Infinity'::numeric",
            name="revaluation_rate_positive",
        ),
        CheckConstraint(
            "(revaluation_currency IS NULL AND revaluation_rate IS NULL) OR "
            "(revaluation_currency IS NOT NULL AND revaluation_rate IS NOT NULL)",
            name="revaluation_consistent",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    receipt_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("receipts.id"), index=True)
    kind: Mapped[str] = mapped_column(Text)
    amount_minor: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(Text)
    exchange_rate: Mapped[Decimal] = mapped_column(Numeric(12, 4))
    rate_date: Mapped[date | None] = mapped_column(Date)
    rate_source: Mapped[str | None] = mapped_column(Text)
    amount_tiyn: Mapped[int] = mapped_column(BigInteger)
    allocation_method: Mapped[str] = mapped_column(Text, server_default=text("'amount'"))
    is_vat_credit: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    revaluation_currency: Mapped[str | None] = mapped_column(Text)
    revaluation_rate: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))


class ReceiptExpenseAllocation(Base):
    __tablename__ = "receipt_expense_allocations"
    __table_args__ = (
        CheckConstraint("amount_tiyn >= 0", name="amount_tiyn_non_negative"),
        UniqueConstraint("expense_id", "receipt_line_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    expense_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("receipt_expenses.id"), index=True
    )
    receipt_line_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("receipt_lines.id"), index=True
    )
    amount_tiyn: Mapped[int] = mapped_column(BigInteger)
