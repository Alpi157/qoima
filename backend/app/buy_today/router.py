from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.buy_today import service
from app.buy_today.schemas import BuyTodayOut, StockBuyTodayOut
from app.db import get_db
from app.rates.router import get_rate_session_factory
from app.rates.service import SessionFactory
from app.schema_types import DbId

router = APIRouter(tags=["buy-today"])


@router.get("/products/{product_id}/buy-today", response_model=BuyTodayOut)
def product_buy_today(
    product_id: DbId,
    db: Session = Depends(get_db),
    session_factory: SessionFactory = Depends(get_rate_session_factory),
) -> BuyTodayOut:
    return service.product_buy_today(db, product_id, session_factory=session_factory)


@router.get("/stock/buy-today", response_model=StockBuyTodayOut)
def stock_buy_today(
    db: Session = Depends(get_db),
    session_factory: SessionFactory = Depends(get_rate_session_factory),
) -> StockBuyTodayOut:
    return service.stock_buy_today(db, session_factory=session_factory)
