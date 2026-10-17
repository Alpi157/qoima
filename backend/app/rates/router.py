from datetime import date as Date

from fastapi import APIRouter, Depends, Query

from app.db import SessionLocal
from app.rates import service
from app.rates.schemas import Currency, RateOut
from app.rates.service import SessionFactory

router = APIRouter(prefix="/rates", tags=["rates"])


def get_rate_session_factory() -> SessionFactory:
    return SessionLocal


@router.get("", response_model=RateOut)
def get_rate(
    currency: Currency,
    date: Date = Query(),
    session_factory: SessionFactory = Depends(get_rate_session_factory),
) -> RateOut:
    return service.get_rate(currency, date, session_factory=session_factory)
