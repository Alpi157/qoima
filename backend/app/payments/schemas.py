import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator

from app.schema_types import MAX_BIGINT, DbId, Note, Reason, check_not_in_future

PaymentStatus = Literal["posted", "cancelled"]
PaymentAmount = Annotated[int, Field(strict=True, ge=1, le=MAX_BIGINT)]


class PaymentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: uuid.UUID
    customer_id: DbId
    amount: PaymentAmount
    paid_at: AwareDatetime | None = None
    note: Note = None

    @field_validator("paid_at")
    @classmethod
    def _not_in_future(cls, value: datetime | None) -> datetime | None:
        return check_not_in_future(value, "Дата оплаты не может быть в будущем")


class PaymentCancel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: Reason


class PaymentCustomerOut(BaseModel):
    id: int
    name: str
    phone: str | None


class PaymentOut(BaseModel):
    id: int
    number: int
    request_id: uuid.UUID
    customer: PaymentCustomerOut
    paid_at: datetime
    amount: int
    note: str | None
    status: PaymentStatus
    cancelled_at: datetime | None
    cancelled_by_name: str | None
    cancel_reason: str | None
    created_by_name: str
    created_at: datetime


class PaymentPage(BaseModel):
    items: list[PaymentOut]
    total: int
    sum_posted: int
