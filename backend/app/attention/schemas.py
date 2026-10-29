import re
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_core import PydanticCustomError

from app.buy_today.schemas import TodayRateOut

KINDS = (
    "below_replacement",
    "markup_drop",
    "old_debt",
    "frozen_stock",
    "running_out",
    "loss_sales",
    "discounts",
    "defects_write_offs",
    "incomplete_data",
)


class BelowReplacement(BaseModel):
    product_id: int
    article: str
    name: str
    unit: str
    qty: int
    sale_price: int
    buy_today: int
    shortage_per_unit: int
    markup_then: int | None
    suggested_price: int
    basis: Literal["purchase", "quote"]
    basis_date: date
    currency: Literal["KZT", "CNY", "USD"]
    goods_today: int
    expenses_revalued: int
    expenses_fixed: int
    rates: list[TodayRateOut]


class MarkupDrop(BaseModel):
    product_id: int
    article: str
    name: str
    unit: str
    qty: int
    sale_price: int
    cost_then: int
    buy_today: int
    markup_then: int
    markup_now: int
    drop_points: int
    price_to_keep_markup: int
    suggested_price: int
    basis: Literal["purchase", "quote"]
    basis_date: date
    currency: Literal["KZT", "CNY", "USD"]
    rates: list[TodayRateOut]


class OldDebt(BaseModel):
    customer_id: int
    name: str
    phone: str | None
    total_debt: int
    old_amount: int
    old_positions_count: int
    oldest_date: date
    oldest_kind: Literal["sale", "adjustment"]
    oldest_number: int
    age_days: int


class FrozenStock(BaseModel):
    product_id: int
    article: str
    name: str
    unit: str
    qty: int
    avg_cost: int
    is_archived: bool
    history_start: date
    last_sale_date: date | None
    days_without_sales: int


class RunningOut(BaseModel):
    product_id: int
    article: str
    name: str
    unit: str
    stock: int
    min_qty: int | None
    sold_qty: int
    days: int
    days_left: int
    runway_days: int
    order_qty: int
    sale_price: int
    trigger: Literal["runway", "min_qty", "both"]
    history_start: date


class LossSale(BaseModel):
    sale_id: int
    number: int
    sold_at: datetime
    qty: int
    unit_price: int
    unit_cost: int


class LossSales(BaseModel):
    product_id: int
    article: str
    name: str
    unit: str
    lines_count: int
    qty: int
    loss: int
    sales: list[LossSale]


class DiscountSale(BaseModel):
    sale_id: int
    number: int
    sold_at: datetime
    customer_name: str | None
    discount: int


class Discounts(BaseModel):
    discount_total: int
    profit: int
    percent: int | None
    threshold_percent: int
    window_days: int
    sales: list[DiscountSale]


class LossProduct(BaseModel):
    product_id: int
    article: str
    name: str
    defect_loss: int
    write_off_value: int
    surplus_value: int
    net: int


class DefectsWriteOffs(BaseModel):
    defect_loss: int
    write_off_value: int
    surplus_value: int
    losses: int
    revenue: int
    percent: int | None
    threshold_percent: int
    window_days: int
    products: list[LossProduct]


class UnknownProduct(BaseModel):
    product_id: int
    article: str
    name: str
    qty: int


class IncompleteStock(BaseModel):
    products_count: int
    products: list[UnknownProduct]


class UnknownSale(BaseModel):
    sale_id: int
    number: int
    sold_at: datetime


class IncompleteSales(BaseModel):
    lines_count: int
    revenue: int
    sales: list[UnknownSale]


class IncompleteRate(BaseModel):
    currency: Literal["CNY", "USD"]
    rate: str | None
    rate_date: date | None
    products_count: int


class BelowReplacementSignal(BaseModel):
    key: str
    kind: Literal["below_replacement"]
    object: Annotated[str, Field(pattern=r"^product:[1-9][0-9]*$")]
    amount: int
    action: Literal["change_price"]
    params: BelowReplacement


class MarkupDropSignal(BaseModel):
    key: str
    kind: Literal["markup_drop"]
    object: Annotated[str, Field(pattern=r"^product:[1-9][0-9]*$")]
    amount: int
    action: Literal["change_price"]
    params: MarkupDrop


class OldDebtSignal(BaseModel):
    key: str
    kind: Literal["old_debt"]
    object: Annotated[str, Field(pattern=r"^customer:[1-9][0-9]*$")]
    amount: int
    action: Literal["open_customer"]
    params: OldDebt


class FrozenStockSignal(BaseModel):
    key: str
    kind: Literal["frozen_stock"]
    object: Annotated[str, Field(pattern=r"^product:[1-9][0-9]*$")]
    amount: int
    action: Literal["open_product"]
    params: FrozenStock


class RunningOutSignal(BaseModel):
    key: str
    kind: Literal["running_out"]
    object: Annotated[str, Field(pattern=r"^product:[1-9][0-9]*$")]
    amount: int
    action: Literal["open_product"]
    params: RunningOut


class LossSalesSignal(BaseModel):
    key: str
    kind: Literal["loss_sales"]
    object: Annotated[str, Field(pattern=r"^product:[1-9][0-9]*$")]
    amount: int
    action: Literal["show_sales"]
    params: LossSales


class DiscountsSignal(BaseModel):
    key: str
    kind: Literal["discounts"]
    object: Literal["business"]
    amount: int
    action: Literal["show_sales"]
    params: Discounts


class DefectsWriteOffsSignal(BaseModel):
    key: str
    kind: Literal["defects_write_offs"]
    object: Literal["business"]
    amount: int
    action: Literal["show_products"]
    params: DefectsWriteOffs


class IncompleteStockSignal(BaseModel):
    key: str
    kind: Literal["incomplete_data"]
    object: Literal["stock"]
    amount: int
    action: Literal["show_products"]
    params: IncompleteStock


class IncompleteSalesSignal(BaseModel):
    key: str
    kind: Literal["incomplete_data"]
    object: Literal["sales"]
    amount: int
    action: Literal["show_sales"]
    params: IncompleteSales


class IncompleteRateSignal(BaseModel):
    key: str
    kind: Literal["incomplete_data"]
    object: Literal["rate:CNY", "rate:USD"]
    amount: int
    action: Literal["show_products"]
    params: IncompleteRate


type IncompleteSignal = Annotated[
    IncompleteStockSignal | IncompleteSalesSignal | IncompleteRateSignal,
    Field(discriminator="object"),
]
Signal = Annotated[
    BelowReplacementSignal
    | MarkupDropSignal
    | OldDebtSignal
    | FrozenStockSignal
    | RunningOutSignal
    | LossSalesSignal
    | DiscountsSignal
    | DefectsWriteOffsSignal
    | IncompleteSignal,
    Field(discriminator="kind"),
]


class Thresholds(BaseModel):
    attention_markup_drop_points: int
    attention_debt_days: int
    attention_frozen_days: int
    attention_runway_days: int
    attention_discount_percent: int
    attention_loss_percent: int
    window_days: Literal[30] = 30
    order_days: Literal[60] = 60


class HiddenSignal(BaseModel):
    key: str
    kind: Literal[
        "below_replacement",
        "markup_drop",
        "old_debt",
        "frozen_stock",
        "running_out",
        "loss_sales",
        "discounts",
        "defects_write_offs",
        "incomplete_data",
    ]
    amount: int
    hidden_until: date


class Pending(BaseModel):
    kind: Literal["frozen_stock", "running_out"]
    products_count: int
    days_left: int
    ready_on: date


class AttentionOut(BaseModel):
    today: date
    thresholds: Thresholds
    signals: list[Signal]
    hidden: list[HiddenSignal]
    pending: list[Pending]
    rates: list[TodayRateOut]


class AttentionKey(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str

    @field_validator("key", mode="before")
    @classmethod
    def valid_key(cls, value: object) -> str:
        pattern = (
            r"(?:(?:below_replacement|markup_drop|frozen_stock|running_out|loss_sales)"
            r":product:[1-9][0-9]*|old_debt:customer:[1-9][0-9]*|"
            r"(?:discounts|defects_write_offs):business|"
            r"incomplete_data:(?:stock|sales|rate:(?:CNY|USD)))"
        )
        if not isinstance(value, str) or re.fullmatch(pattern, value) is None:
            raise PydanticCustomError("attention_key_invalid", "Неверный ключ сигнала")
        return value


class HiddenUntil(AttentionKey):
    hidden_until: date
