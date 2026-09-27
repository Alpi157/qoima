from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schema_types import EntityId, Reason

MAX_ADJUSTMENT_QTY = 100_000

AdjustmentQty = Annotated[int, Field(strict=True, ge=-MAX_ADJUSTMENT_QTY, le=MAX_ADJUSTMENT_QTY)]


class AdjustmentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: EntityId
    qty: AdjustmentQty
    reason: Reason

    @field_validator("qty")
    @classmethod
    def _non_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("Количество не может быть нулём")
        return value


class MovementOut(BaseModel):
    id: int
    created_at: datetime
    qty: int
    kind: str
    doc_type: str | None
    doc_id: int | None
    doc_number: int | None
    note: str | None
    created_by_name: str
    balance_after: int


class MovementPage(BaseModel):
    items: list[MovementOut]
    total: int


class AdjustmentOut(BaseModel):
    movement: MovementOut
    stock: int
