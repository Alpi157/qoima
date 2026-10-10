from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.reports import service
from app.reports.schemas import CustomerReportPage, ProductReportPage, SummaryOut

router = APIRouter(prefix="/reports", tags=["reports"])
FromDate = Annotated[date, Query(alias="from")]
ToDate = Annotated[date, Query(alias="to")]


@router.get("/summary", response_model=SummaryOut)
def summary(date_from: FromDate, date_to: ToDate, db: Session = Depends(get_db)) -> SummaryOut:
    return service.summary(db, date_from, date_to)


@router.get("/products", response_model=ProductReportPage)
def products(
    date_from: FromDate,
    date_to: ToDate,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> ProductReportPage:
    return service.products(db, date_from, date_to, limit, offset)


@router.get("/customers", response_model=CustomerReportPage)
def customers(
    date_from: FromDate,
    date_to: ToDate,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> CustomerReportPage:
    return service.customers(db, date_from, date_to, limit, offset)
