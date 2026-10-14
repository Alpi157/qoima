import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator
from pydantic_core import PydanticCustomError

from app.schema_types import MAX_MONEY, DbId, Reason, check_not_in_future

DebtAdjustmentStatus = Literal["posted", "cancelled"]
DebtAdjustmentAmount = Annotated[int, Field(strict=True, ge=-MAX_MONEY, le=MAX_MONEY)]


class DebtAdjustmentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: uuid.UUID
    customer_id: DbId
    amount: DebtAdjustmentAmount
    adjusted_at: AwareDatetime | None = None
    reason: Reason

    @field_validator("amount")
    @classmethod
    def _nonzero(cls, value: int) -> int:
        if value == 0:
            raise PydanticCustomError("amount_zero", "Сумма исправления не может быть нулевой")
        return value

    @field_validator("adjusted_at")
    @classmethod
    def _not_in_future(cls, value: datetime | None) -> datetime | None:
        return check_not_in_future(value, "Дата исправления долга не может быть в будущем")


class DebtAdjustmentCancel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: Reason


class DebtAdjustmentCustomerOut(BaseModel):
    id: int
    name: str
    phone: str | None


class DebtAdjustmentOut(BaseModel):
    id: int
    number: int
    request_id: uuid.UUID
    customer: DebtAdjustmentCustomerOut
    adjusted_at: datetime
    amount: int
    reason: str
    status: DebtAdjustmentStatus
    cancelled_at: datetime | None
    cancelled_by_name: str | None
    cancel_reason: str | None
    created_by_name: str
    created_at: datetime


class DebtAdjustmentPage(BaseModel):
    items: list[DebtAdjustmentOut]
    total: int
    sum_posted: int
