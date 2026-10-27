import re
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic_core import PydanticCustomError

from app.schema_types import Trimmed, reject_explicit_nulls

IIN_BIN_PATTERN = re.compile(r"[0-9]{12}")
IIN_BIN_MESSAGE = "ИИН/БИН должен состоять из 12 цифр"


# Names printed on the invoice: the seller, the person responsible, signature transcripts.
Name = Annotated[str, Trimmed, Field(max_length=255)]
IinBin = Annotated[str, Trimmed]


class BusinessSettingsUpdate(BaseModel):
    """Invoice fields are required; omitted receipt settings keep their values."""

    model_config = ConfigDict(extra="forbid")

    seller_name: Name
    seller_iin_bin: IinBin
    responsible_person: Name
    # Empty: the invoice shows the name of the user who posted the sale.
    released_by_name: Name
    chief_accountant: Name
    is_vat_payer: bool | None = None
    rate_warning_percent: Annotated[int, Field(strict=True, ge=1, le=100)] | None = None

    card_commission_percent: str | None = None
    tax_percent: str | None = None

    @field_validator("card_commission_percent", "tax_percent", mode="before")
    @classmethod
    def _percent(cls, value: object) -> str:
        if not isinstance(value, str) or not re.fullmatch(
            r"[0-9]+(?:\.[0-9]{1,2})?", value.strip()
        ):
            raise PydanticCustomError(
                "percent_invalid", "Введите число от 0 до 100, не больше двух знаков после запятой."
            )
        value = value.strip()
        whole, _, fraction = value.partition(".")
        if len(whole) > 3 or int(whole) * 100 + int(fraction.ljust(2, "0")) > 10000:
            raise PydanticCustomError(
                "percent_invalid", "Введите число от 0 до 100, не больше двух знаков после запятой."
            )
        return value

    @model_validator(mode="before")
    @classmethod
    def _no_nulls(cls, data: object) -> object:
        return reject_explicit_nulls(data, ("is_vat_payer", "rate_warning_percent"))

    @field_validator("seller_iin_bin")
    @classmethod
    def _iin_bin_digits(cls, value: str) -> str:
        if value and not IIN_BIN_PATTERN.fullmatch(value):
            raise PydanticCustomError("iin_bin_format", IIN_BIN_MESSAGE)
        return value


class BusinessSettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    seller_name: str
    seller_iin_bin: str
    responsible_person: str
    released_by_name: str
    chief_accountant: str
    is_vat_payer: bool
    rate_warning_percent: int
    card_commission_percent: str
    tax_percent: str
    updated_at: datetime
