from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schema_types import BlankToNone, NonEmpty, Trimmed, reject_explicit_nulls

MAX_SALE_PRICE = 100_000_000_000

Article = Annotated[str, NonEmpty, Field(max_length=64)]
Name = Annotated[str, NonEmpty, Field(max_length=255)]
Unit = Annotated[str, NonEmpty, Field(max_length=16)]
Brand = Annotated[Annotated[str, Trimmed, Field(max_length=64)] | None, BlankToNone]
Note = Annotated[Annotated[str, Trimmed, Field(max_length=1000)] | None, BlankToNone]
# Money in tiyn; strict so that 1.5 or "100" is rejected instead of coerced.
SalePrice = Annotated[int, Field(strict=True, ge=0, le=MAX_SALE_PRICE)]


class ProductCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    article: Article
    name: Name
    brand: Brand = None
    unit: Unit = "шт"
    sale_price: SalePrice
    note: Note = None


class ProductUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    article: Article | None = None
    name: Name | None = None
    brand: Brand = None
    unit: Unit | None = None
    sale_price: SalePrice | None = None
    note: Note = None
    is_archived: bool | None = None

    @model_validator(mode="before")
    @classmethod
    def _no_nulls_for_required(cls, data: object) -> object:
        return reject_explicit_nulls(data, ("article", "name", "unit", "sale_price", "is_archived"))


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    article: str
    article_norm: str
    brand: str | None
    name: str
    unit: str
    sale_price: int
    note: str | None
    is_archived: bool
    created_at: datetime
    updated_at: datetime
    stock: int


class ProductPage(BaseModel):
    items: list[ProductOut]
    total: int
