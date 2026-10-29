from datetime import date
from typing import Literal

from pydantic import BaseModel

from app.receipts.schemas import ReceiptCurrency

BasisKind = Literal["purchase", "quote"]


class TodayRateOut(BaseModel):
    currency: ReceiptCurrency
    rate: str | None
    rate_date: date | None
    exact: bool | None


class ActiveQuoteOut(BaseModel):
    id: int
    currency: ReceiptCurrency
    price_minor: int
    quoted_on: date
    cancel_fallback_basis: BasisKind | None


class BuyTodayOut(BaseModel):
    basis: BasisKind | None
    basis_date: date | None
    basis_receipt_id: int | None
    currency: ReceiptCurrency | None
    price_minor: int | None
    cost_then: int | None
    avg_cost: int | None
    today_rate: str | None
    today_rate_date: date | None
    today_rate_exact: bool | None
    goods_today: int | None
    expenses_revalued: int | None
    expenses_fixed: int | None
    buy_today: int | None
    sale_price: int
    markup_then: int | None
    markup_now: int | None
    suggested_price: int | None
    price_to_keep_markup: int | None
    difference_vs_avg: int | None
    reason_unavailable: Literal["no_purchase", "no_rate"] | None
    active_quote: ActiveQuoteOut | None
    expenses_known: bool
    rates: list[TodayRateOut]


class StockBuyTodayValues(BaseModel):
    cost_value: int = 0
    buy_today_value: int = 0
    difference: int = 0
    difference_percent: str | None = None


class StockBuyTodayGroup(StockBuyTodayValues):
    currency: ReceiptCurrency
    products_count: int = 0
    qty: int = 0


class StockBuyTodayOut(BaseModel):
    groups: list[StockBuyTodayGroup]
    total: StockBuyTodayValues
    rates: list[TodayRateOut]
    without_basis_count: int
    without_basis_cost_value: int
