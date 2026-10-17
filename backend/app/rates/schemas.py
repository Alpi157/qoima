from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, field_serializer

Currency = Literal["CNY", "USD"]
CURRENCIES: tuple[Currency, ...] = ("CNY", "USD")


class RateOut(BaseModel):
    currency: Currency
    requested_date: date
    rate_date: date
    rate: Decimal
    source: Literal["nbk"] = "nbk"
    exact: bool

    @field_serializer("rate")
    def serialize_rate(self, value: Decimal) -> str:
        return format(value, ".4f")
