from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel


class ReceivedOut(BaseModel):
    cash: int
    card: int
    total: int


class DayOut(BaseModel):
    date: date
    revenue: int
    profit: int


class SummaryOut(BaseModel):
    buy_today_cost: int
    buy_today_unknown_count: int
    revenue: int
    sales_count: int
    cost: int
    profit: int
    revenue_unknown_cost: int
    debt_given: int
    returns_total: int
    returns_count: int
    defect_loss: int
    write_off_value: int
    write_off_count: int
    surplus_value: int
    adjustment_unknown_count: int
    discount_total: int
    discount_unknown_count: int
    received: ReceivedOut
    days: list[DayOut]


class ProductReportItem(BaseModel):
    product_id: int
    article: str
    name: str
    unit: str
    qty: int
    revenue: int
    cost: int
    profit: int
    revenue_unknown_cost: int


class ProductReportPage(BaseModel):
    items: list[ProductReportItem]
    total: int


class CustomerReportItem(BaseModel):
    customer_id: int | None
    name: str | None
    sales_count: int
    revenue: int
    profit: int
    revenue_unknown_cost: int


class CustomerReportPage(BaseModel):
    items: list[CustomerReportItem]
    total: int


AdjustmentDirection = Literal["minus", "plus"]


class AdjustmentReportItem(BaseModel):
    movement_id: int
    created_at: datetime
    product_id: int
    article: str
    name: str
    unit: str
    qty: int
    unit_cost: int | None
    value: int | None
    reason: str | None
    created_by_name: str


class AdjustmentReportPage(BaseModel):
    items: list[AdjustmentReportItem]
    total: int
