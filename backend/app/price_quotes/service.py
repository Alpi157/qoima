from psycopg.errors import UniqueViolation
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.catalog.models import Product
from app.db_utils import lock_request_id
from app.errors import (
    PriceQuoteAlreadyCancelledError,
    PriceQuoteNotFoundError,
    PriceQuoteRequestConflictError,
    ProductNotFoundError,
)
from app.price_quotes.models import ProductPriceQuote
from app.price_quotes.schemas import PriceQuoteCreate, PriceQuoteOut

PRICE_QUOTE_REQUEST_LOCK = 2203
REQUEST_ID_CONSTRAINT = "uq_product_price_quotes_request_id"


def _existing(db: Session, product_id: int, data: PriceQuoteCreate) -> PriceQuoteOut | None:
    quote = db.scalar(
        select(ProductPriceQuote).where(ProductPriceQuote.request_id == data.request_id)
    )
    if quote is None:
        return None
    if (quote.product_id, quote.currency, quote.price_minor, quote.quoted_on) != (
        product_id,
        data.currency,
        data.price_minor,
        data.quoted_on,
    ):
        raise PriceQuoteRequestConflictError(params={"id": quote.id})
    return PriceQuoteOut.model_validate(quote)


def create_quote(
    db: Session, product_id: int, data: PriceQuoteCreate, user_id: int
) -> tuple[PriceQuoteOut, bool]:
    lock_request_id(db, PRICE_QUOTE_REQUEST_LOCK, data.request_id)
    existing = _existing(db, product_id, data)
    if existing is not None:
        return existing, False
    if db.get(Product, product_id) is None:
        raise ProductNotFoundError()
    quote = ProductPriceQuote(product_id=product_id, created_by=user_id, **data.model_dump())
    db.add(quote)
    try:
        db.commit()
    except IntegrityError as exc:
        if not (
            isinstance(exc.orig, UniqueViolation)
            and exc.orig.diag.constraint_name == REQUEST_ID_CONSTRAINT
        ):
            raise
        db.rollback()
        existing = _existing(db, product_id, data)
        if existing is None:
            raise
        return existing, False
    db.refresh(quote)
    return PriceQuoteOut.model_validate(quote), True


def cancel_quote(db: Session, quote_id: int, user_id: int) -> PriceQuoteOut:
    quote = db.scalar(
        select(ProductPriceQuote)
        .where(ProductPriceQuote.id == quote_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if quote is None:
        raise PriceQuoteNotFoundError()
    if quote.status == "cancelled":
        raise PriceQuoteAlreadyCancelledError()
    quote.status = "cancelled"
    quote.cancelled_at = func.now()
    quote.cancelled_by = user_id
    db.commit()
    db.refresh(quote)
    return PriceQuoteOut.model_validate(quote)
