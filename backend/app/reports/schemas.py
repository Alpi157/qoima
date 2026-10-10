from datetime import date

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
    revenue: int
    sales_count: int
    cost: int
    profit: int
    revenue_unknown_cost: int
    debt_given: int
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


class CustomerReportPage(BaseModel):
    items: list[CustomerReportItem]
    total: int
