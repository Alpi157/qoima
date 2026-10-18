import re
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_serializer,
    field_validator,
    model_validator,
)
from pydantic_core import PydanticCustomError

from app.catalog.schemas import MAX_SALE_PRICE
from app.schema_types import (
    MAX_LINES,
    MAX_MONEY,
    BlankToNone,
    DbId,
    Note,
    Qty,
    Reason,
    Trimmed,
    check_not_in_future,
)

ReceiptStatus = Literal["posted", "cancelled"]
ReceiptCurrency = Literal["KZT", "CNY", "USD"]
ExpenseKind = Literal[
    "delivery", "customs_duty", "antidumping_duty", "import_vat", "broker", "bank", "other"
]
AllocationMethod = Literal["amount", "quantity", "selected", "manual"]
Supplier = Annotated[Annotated[str, Trimmed, Field(max_length=255)] | None, BlankToNone]
UnitCost = Annotated[int, Field(strict=True, ge=0, le=MAX_SALE_PRICE)]
RateString = Annotated[str, Field(strict=True, pattern=r"^[0-9]{1,8}(\.[0-9]{1,4})?$")]
RATE_PATTERN = re.compile(r"[0-9]{1,8}(\.[0-9]{1,4})?")


def _invalid(field: tuple[str | int, ...], kind: str, message: str, value: object = None) -> None:
    raise ValidationError.from_exception_data(
        "Receipt input",
        [{"type": PydanticCustomError(kind, message), "loc": field, "input": value}],
    )


class RateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    currency: ReceiptCurrency = "KZT"
    exchange_rate: RateString | None = None
    rate_source: Literal["nbk", "manual"] | None = None
    rate_date: date | None = None

    @field_validator("exchange_rate", mode="before")
    @classmethod
    def _rate_format(cls, value: object) -> object:
        if value is not None and (
            not isinstance(value, str) or not RATE_PATTERN.fullmatch(value) or Decimal(value) <= 0
        ):
            raise PydanticCustomError(
                "rate_format", "Курс должен быть положительной десятичной строкой до 4 знаков"
            )
        return value

    @model_validator(mode="after")
    def _rate_fields(self) -> Self:
        if self.currency == "KZT":
            for field in ("exchange_rate", "rate_source", "rate_date"):
                if getattr(self, field) is not None:
                    _invalid((field,), "rate_not_allowed", "Для тенге курс не указывается")
        else:
            for field in ("exchange_rate", "rate_source"):
                if getattr(self, field) is None:
                    _invalid((field,), "rate_required", "Укажите курс и его источник")
            if self.rate_source == "nbk" and self.rate_date is None:
                _invalid(("rate_date",), "rate_date_required", "Укажите дату курса Нацбанка")
            if self.rate_source == "manual" and self.rate_date is not None:
                _invalid(
                    ("rate_date",), "rate_date_not_allowed", "Дату ручного курса задаёт сервер"
                )
        return self

    @property
    def rate_decimal(self) -> Decimal:
        return Decimal(self.exchange_rate) if self.exchange_rate is not None else Decimal(1)

    @property
    def rate_scaled(self) -> int:
        return int(self.rate_decimal * 10_000)


class ReceiptLineIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: DbId
    qty: Qty
    unit_price_minor: UnitCost | None = None
    unit_cost: UnitCost | None = Field(default=None, json_schema_extra={"deprecated": True})

    @model_validator(mode="before")
    @classmethod
    def _price_fields(cls, data: object) -> object:
        if isinstance(data, dict):
            if "unit_price_minor" in data and "unit_cost" in data:
                _invalid(
                    ("unit_price_minor",), "line_price_both", "Передайте только одно поле цены"
                )
            if data.get("unit_price_minor") is None and data.get("unit_cost") is None:
                _invalid(("unit_price_minor",), "line_price_required", "Укажите цену строки")
        return data

    @property
    def price_minor(self) -> int:
        price = self.unit_price_minor if self.unit_price_minor is not None else self.unit_cost
        assert price is not None
        return price


class ManualAllocationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: DbId
    amount_tiyn: Annotated[int, Field(strict=True, ge=0, le=MAX_MONEY)]


class ExpenseIn(RateInput):
    kind: ExpenseKind
    amount_minor: Annotated[int, Field(strict=True, ge=1, le=MAX_MONEY)]
    allocation_method: AllocationMethod = "amount"
    product_ids: list[DbId] | None = Field(default=None, max_length=MAX_LINES)
    manual: list[ManualAllocationIn] | None = Field(default=None, max_length=MAX_LINES)

    @model_validator(mode="after")
    def _targets(self) -> Self:
        required = {"selected": "product_ids", "manual": "manual"}.get(self.allocation_method)
        for field in ("product_ids", "manual"):
            value = getattr(self, field)
            if field == required and not value:
                _invalid(
                    (field,), "expense_targets_required", "Укажите строки распределения расхода"
                )
            if field != required and value is not None:
                _invalid(
                    (field,), "expense_targets_not_allowed", "Цели не разрешены для этого способа"
                )
        if required:
            values = (
                self.product_ids
                if required == "product_ids"
                else [v.product_id for v in self.manual]
            )
            seen = set()
            for index, pid in enumerate(values):
                if pid in seen:
                    loc = (
                        (required, index)
                        if required == "product_ids"
                        else (required, index, "product_id")
                    )
                    _invalid(loc, "expense_target_duplicate", "Товар в целях указан дважды", pid)
                seen.add(pid)
        return self


class ReceiptInput(RateInput):
    lines: list[ReceiptLineIn] = Field(min_length=1, max_length=MAX_LINES)
    supplier: Supplier = None
    note: Note = None
    received_at: AwareDatetime | None = None
    expenses: list[ExpenseIn] = Field(default_factory=list, max_length=50)
    confirmed_warnings: list[Annotated[str, Field(strict=True, max_length=200)]] | None = Field(
        default=None, max_length=100
    )

    @field_validator("received_at")
    @classmethod
    def _not_in_future(cls, value: datetime | None) -> datetime | None:
        return check_not_in_future(value, "Дата прихода не может быть в будущем")

    @model_validator(mode="after")
    def _receipt_fields(self) -> Self:
        for index, line in enumerate(self.lines):
            if self.currency != "KZT" and line.unit_cost is not None:
                _invalid(
                    ("lines", index, "unit_cost"),
                    "unit_cost_kzt_only",
                    "Поле unit_cost разрешено только для тенге",
                )
        products = {line.product_id for line in self.lines}
        for index, expense in enumerate(self.expenses):
            targets = [
                ("product_ids", i, pid) for i, pid in enumerate(expense.product_ids or [])
            ] + [("manual", i, value.product_id) for i, value in enumerate(expense.manual or [])]
            for field, target_index, pid in targets:
                if pid not in products:
                    loc = ("expenses", index, field, target_index)
                    if field == "manual":
                        loc += ("product_id",)
                    _invalid(
                        loc, "expense_target_not_in_receipt", "Товара нет в строках прихода", pid
                    )
        return self


class ReceiptCreate(ReceiptInput):
    request_id: UUID


class ReceiptPreviewIn(ReceiptInput):
    request_id: UUID | None = None


class RateDeviationParams(BaseModel):
    target: Literal["receipt", "expense"]
    index: int | None = None
    currency: Literal["CNY", "USD"]
    rate: str
    nbk_rate: str
    nbk_rate_date: date
    nbk_exact: bool
    percent: int


class CostJumpParams(BaseModel):
    product_id: int
    article: str
    unit_cost: int
    previous_cost: int
    previous_received_at: datetime


class CostNotBelowPriceParams(BaseModel):
    product_id: int
    article: str
    unit_cost: int
    sale_price: int


class RateDeviationWarning(BaseModel):
    key: str
    code: Literal["rate_deviation"] = "rate_deviation"
    params: RateDeviationParams


class CostJumpWarning(BaseModel):
    key: str
    code: Literal["cost_jump"] = "cost_jump"
    params: CostJumpParams


class CostNotBelowPriceWarning(BaseModel):
    key: str
    code: Literal["cost_not_below_price"] = "cost_not_below_price"
    params: CostNotBelowPriceParams


ReceiptWarning = Annotated[
    RateDeviationWarning | CostJumpWarning | CostNotBelowPriceWarning, Field(discriminator="code")
]


class ReceiptDefaultsOut(BaseModel):
    currency: ReceiptCurrency
    source: Literal["supplier", "last", "default"]


class ReceiptCancel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: Reason


class ReceiptLineOut(BaseModel):
    product_id: int
    article: str
    name: str
    unit: str
    qty: int
    unit_price_minor: int | None
    goods_total: int | None
    expenses_total: int
    vat_credit_total: int
    unit_cost: int | None


class AllocationOut(BaseModel):
    receipt_line_id: int
    product_id: int
    amount_tiyn: int


class ExpenseOut(BaseModel):
    id: int
    kind: ExpenseKind
    amount_minor: int
    currency: ReceiptCurrency
    exchange_rate: Decimal
    rate_date: date | None
    rate_source: Literal["nbk", "manual"] | None
    amount_tiyn: int
    allocation_method: AllocationMethod
    is_vat_credit: bool
    revaluation_currency: Literal["CNY", "USD"] | None
    revaluation_rate: Decimal | None
    allocations: list[AllocationOut]

    @field_serializer("exchange_rate")
    def serialize_rate(self, value: Decimal) -> str:
        return format(value, ".4f")

    @field_serializer("revaluation_rate")
    def serialize_revaluation_rate(self, value: Decimal | None) -> str | None:
        return format(value, ".4f") if value is not None else None


class ReceiptOut(BaseModel):
    id: int
    number: int
    request_id: UUID | None
    received_at: datetime
    supplier: str | None
    note: str | None
    currency: ReceiptCurrency
    exchange_rate: Decimal
    rate_date: date | None
    rate_source: Literal["nbk", "manual"] | None
    vat_payer_snapshot: bool
    status: ReceiptStatus
    cancelled_at: datetime | None
    cancel_reason: str | None
    cancelled_by_name: str | None
    created_by_name: str
    created_at: datetime
    lines: list[ReceiptLineOut]
    expenses: list[ExpenseOut]
    goods_total: int | None
    expenses_total: int
    vat_credit_total: int
    total_qty: int
    total_cost: int | None

    @field_serializer("exchange_rate")
    def serialize_rate(self, value: Decimal) -> str:
        return format(value, ".4f")


class ReceiptListItem(BaseModel):
    id: int
    number: int
    received_at: datetime
    supplier: str | None
    currency: ReceiptCurrency
    status: ReceiptStatus
    lines_count: int
    total_qty: int
    total_cost: int | None


class ReceiptPage(BaseModel):
    items: list[ReceiptListItem]
    total: int


class ReceiptPreviewLineOut(ReceiptLineOut):
    unit_price_minor: int
    goods_total: int
    unit_cost: int
    sale_price: int
    previous_cost: int | None
    markup_percent: int | None


class PreviewAllocationOut(BaseModel):
    product_id: int
    amount_tiyn: int


class ReceiptPreviewExpenseOut(BaseModel):
    index: int
    kind: ExpenseKind
    amount_tiyn: int
    is_vat_credit: bool
    revaluation_currency: Literal["CNY", "USD"] | None
    revaluation_rate: Decimal | None
    allocations: list[PreviewAllocationOut]

    @field_serializer("revaluation_rate")
    def serialize_revaluation_rate(self, value: Decimal | None) -> str | None:
        return format(value, ".4f") if value is not None else None


class ReceiptPreviewOut(BaseModel):
    currency: ReceiptCurrency
    exchange_rate: Decimal
    rate_date: date | None
    rate_source: Literal["nbk", "manual"] | None
    vat_payer: bool
    lines: list[ReceiptPreviewLineOut]
    expenses: list[ReceiptPreviewExpenseOut]
    goods_total: int
    expenses_total: int
    vat_credit_total: int
    total_cost: int
    warnings: list[ReceiptWarning]

    @field_serializer("exchange_rate")
    def serialize_rate(self, value: Decimal) -> str:
        return format(value, ".4f")
