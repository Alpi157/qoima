import re
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schema_types import Trimmed

IIN_BIN_PATTERN = re.compile(r"[0-9]{12}")
IIN_BIN_MESSAGE = "ИИН/БИН должен состоять из 12 цифр"


# Names printed on the invoice: the seller, the person responsible, signature transcripts.
Name = Annotated[str, Trimmed, Field(max_length=255)]
IinBin = Annotated[str, Trimmed]


class BusinessSettingsUpdate(BaseModel):
    """PUT body: every field is required, an empty string clears it."""

    model_config = ConfigDict(extra="forbid")

    seller_name: Name
    seller_iin_bin: IinBin
    responsible_person: Name
    # Empty: the invoice shows the name of the user who posted the sale.
    released_by_name: Name
    chief_accountant: Name

    @field_validator("seller_iin_bin")
    @classmethod
    def _iin_bin_digits(cls, value: str) -> str:
        if value and not IIN_BIN_PATTERN.fullmatch(value):
            raise ValueError(IIN_BIN_MESSAGE)
        return value


class BusinessSettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    seller_name: str
    seller_iin_bin: str
    responsible_person: str
    released_by_name: str
    chief_accountant: str
    updated_at: datetime
