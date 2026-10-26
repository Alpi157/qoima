from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.auth.dependencies import current_user
from app.auth.models import User
from app.db import get_db
from app.price_quotes import service
from app.price_quotes.schemas import PriceQuoteCreate, PriceQuoteOut
from app.schema_types import DbId

router = APIRouter(tags=["price-quotes"])


@router.post(
    "/products/{product_id}/price-quotes",
    response_model=PriceQuoteOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        200: {"model": PriceQuoteOut, "description": "Цена с этим request_id уже сохранена"}
    },
)
def create_quote(
    product_id: DbId,
    payload: PriceQuoteCreate,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> PriceQuoteOut:
    quote, created = service.create_quote(db, product_id, payload, user.id)
    if not created:
        response.status_code = status.HTTP_200_OK
    return quote


@router.post("/price-quotes/{quote_id}/cancel", response_model=PriceQuoteOut)
def cancel_quote(
    quote_id: DbId, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> PriceQuoteOut:
    return service.cancel_quote(db, quote_id, user.id)
