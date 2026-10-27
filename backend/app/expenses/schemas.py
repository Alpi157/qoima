import uuid
from datetime import date, datetime
from typing import Annotated, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_core import PydanticCustomError

from app.rates import service as rates_service
from app.schema_types import MAX_MONEY, BlankToNone, Reason, Trimmed

ExpenseCategory = Literal[
    "rent", "salary", "customer_delivery", "communication", "advertising", "taxes", "bank", "other"
]
EXPENSE_CATEGORIES = get_args(ExpenseCategory)
ExpenseStatus = Literal["posted", "cancelled"]
ExpenseNote = Annotated[Annotated[str, Trimmed, Field(max_length=500)] | None, BlankToNone]


class ExpenseItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expense_date: date
    category: ExpenseCategory
    amount: Annotated[int, Field(strict=True, ge=1, le=MAX_MONEY)]
    note: ExpenseNote = None

    @field_validator("expense_date")
    @classmethod
    def _not_future(cls, value: date) -> date:
        if value > rates_service.today_local():
            raise PydanticCustomError("expense_date_in_future", "Нельзя выбрать будущую дату.")
        return value


class ExpenseCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: uuid.UUID
    items: Annotated[list[ExpenseItem], Field(min_length=1, max_length=20)]


class ExpenseCancel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: Reason


class ExpenseOut(BaseModel):
    id: int
    number: int
    expense_date: date
    category: ExpenseCategory
    amount: int
    note: str | None
    status: ExpenseStatus
    created_at: datetime
    created_by_name: str
    cancelled_at: datetime | None
    cancelled_by_name: str | None
    cancel_reason: str | None


class ExpenseBatch(BaseModel):
    items: list[ExpenseOut]


class ExpensePage(ExpenseBatch):
    total: int
    posted_amount: int
