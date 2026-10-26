from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_core import PydanticCustomError

from app.catalog.schemas import MAX_SALE_PRICE
from app.rates import service as rates_service
from app.receipts.schemas import ReceiptCurrency


class PriceQuoteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: UUID
    currency: ReceiptCurrency
    price_minor: Annotated[int, Field(strict=True, ge=1, le=MAX_SALE_PRICE)]
    quoted_on: date

    @field_validator("quoted_on")
    @classmethod
    def _not_in_future(cls, value: date) -> date:
        if value > rates_service.today_local():
            raise PydanticCustomError(
                "date_in_future", "Дата цены поставщика не может быть в будущем"
            )
        return value


class PriceQuoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    request_id: UUID
    product_id: int
    currency: ReceiptCurrency
    price_minor: int
    quoted_on: date
    status: Literal["posted", "cancelled"]
    cancelled_at: datetime | None
    cancelled_by: int | None
    created_by: int
    created_at: datetime
