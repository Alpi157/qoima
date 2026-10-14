import uuid
from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic_core import PydanticCustomError

from app.schema_types import (
    MAX_LINES,
    MAX_MONEY,
    DbId,
    Note,
    PaymentMethod,
    Qty,
    Reason,
    check_not_in_future,
)

ReturnStatus = Literal["posted", "cancelled"]
ReturnCondition = Literal["good", "defective"]
ExpectedAmount = Annotated[int, Field(strict=True, ge=0, le=MAX_MONEY)]


class ReturnLineIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sale_line_id: DbId
    qty: Qty
    condition: ReturnCondition


class ReturnCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: uuid.UUID
    sale_id: DbId
    returned_at: AwareDatetime | None = None
    note: Note = None
    refund_method: PaymentMethod | None = None
    expected_debt_credit: ExpectedAmount | None = None
    expected_refund_amount: ExpectedAmount | None = None
    lines: list[ReturnLineIn] = Field(min_length=1, max_length=MAX_LINES)

    @model_validator(mode="after")
    def _expected_pair(self) -> Self:
        if (self.expected_debt_credit is None) != (self.expected_refund_amount is None):
            raise PydanticCustomError(
                "return_expected_split_pair",
                "Ожидаемые суммы списания с долга и возврата денег нужно передать вместе",
            )
        return self

    @field_validator("returned_at")
    @classmethod
    def _not_in_future(cls, value: datetime | None) -> datetime | None:
        return check_not_in_future(value, "Дата возврата не может быть в будущем")


class ReturnCancel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: Reason


class ReturnCustomerOut(BaseModel):
    id: int
    name: str
    phone: str | None


class ReturnSaleOut(BaseModel):
    id: int
    number: int


class ReturnLineOut(BaseModel):
    id: int
    sale_line_id: int
    product_id: int
    article: str
    name: str
    unit: str
    qty: int
    unit_price: int
    line_total: int
    unit_cost: int | None
    condition: ReturnCondition


class ReturnListItem(BaseModel):
    id: int
    number: int
    request_id: uuid.UUID
    sale: ReturnSaleOut
    customer: ReturnCustomerOut | None
    returned_at: datetime
    total: int
    debt_credit: int
    refund_amount: int
    refund_method: PaymentMethod | None
    note: str | None
    status: ReturnStatus
    cancelled_at: datetime | None
    cancelled_by_name: str | None
    cancel_reason: str | None
    created_by_name: str
    created_at: datetime


class ReturnOut(ReturnListItem):
    lines: list[ReturnLineOut]


class ReturnPage(BaseModel):
    items: list[ReturnListItem]
    total: int
    sum_posted: int
