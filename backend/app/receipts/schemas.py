from datetime import datetime
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator

from app.catalog.schemas import MAX_SALE_PRICE
from app.schema_types import (
    MAX_LINES,
    BlankToNone,
    DbId,
    Note,
    Qty,
    Reason,
    Trimmed,
    check_not_in_future,
)

ReceiptStatus = Literal["posted", "cancelled"]
Supplier = Annotated[Annotated[str, Trimmed, Field(max_length=255)] | None, BlankToNone]
# Money in tiyn.
UnitCost = Annotated[int, Field(strict=True, ge=0, le=MAX_SALE_PRICE)]


class ReceiptLineIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: DbId
    qty: Qty
    unit_cost: UnitCost | None = None


class ReceiptCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lines: list[ReceiptLineIn] = Field(min_length=1, max_length=MAX_LINES)
    supplier: Supplier = None
    note: Note = None
    received_at: AwareDatetime | None = None

    @field_validator("received_at")
    @classmethod
    def _not_in_future(cls, value: datetime | None) -> datetime | None:
        return check_not_in_future(value, "Дата прихода не может быть в будущем")


class ReceiptCancel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: Reason


class ReceiptLineOut(BaseModel):
    product_id: int
    article: str
    name: str
    qty: int
    unit_cost: int | None


class ReceiptOut(BaseModel):
    id: int
    number: int
    received_at: datetime
    supplier: str | None
    note: str | None
    status: ReceiptStatus
    cancelled_at: datetime | None
    cancel_reason: str | None
    cancelled_by_name: str | None
    created_by_name: str
    created_at: datetime
    lines: list[ReceiptLineOut]
    total_qty: int
    total_cost: int | None


class ReceiptListItem(BaseModel):
    id: int
    number: int
    received_at: datetime
    supplier: str | None
    status: ReceiptStatus
    lines_count: int
    total_qty: int
    total_cost: int | None


class ReceiptPage(BaseModel):
    items: list[ReceiptListItem]
    total: int
