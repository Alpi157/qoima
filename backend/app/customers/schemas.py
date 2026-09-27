from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schema_types import BlankToNone, NonEmpty, Trimmed, reject_explicit_nulls

Name = Annotated[str, NonEmpty, Field(max_length=255)]
Phone = Annotated[Annotated[str, Trimmed, Field(max_length=32)] | None, BlankToNone]
Note = Annotated[Annotated[str, Trimmed, Field(max_length=1000)] | None, BlankToNone]


class CustomerCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    phone: Phone = None
    note: Note = None


class CustomerUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    phone: Phone = None
    note: Note = None

    @model_validator(mode="before")
    @classmethod
    def _no_nulls_for_required(cls, data: object) -> object:
        return reject_explicit_nulls(data, ("name",))


class CustomerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    phone: str | None
    note: str | None
    created_at: datetime


class CustomerPage(BaseModel):
    items: list[CustomerOut]
    total: int
