from datetime import date

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.auth.dependencies import current_user
from app.auth.models import User
from app.db import get_db
from app.sales import service
from app.sales.schemas import SaleCancel, SaleCreate, SaleOut, SalePage, SaleStatus
from app.schema_types import DbId

router = APIRouter(prefix="/sales", tags=["sales"])


@router.get("", response_model=SalePage)
def list_sales(
    date_from: date | None = None,
    date_to: date | None = None,
    customer_id: DbId | None = None,
    status: SaleStatus | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> SalePage:
    return service.list_sales(db, date_from, date_to, customer_id, status, limit, offset)


@router.get("/{sale_id}", response_model=SaleOut)
def get_sale(sale_id: DbId, db: Session = Depends(get_db)) -> SaleOut:
    return service.get_sale(db, sale_id)


@router.post(
    "",
    response_model=SaleOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_200_OK: {
            "model": SaleOut,
            "description": "Продажа с этим request_id уже проведена, возвращена она же",
        }
    },
)
def post_sale(
    payload: SaleCreate,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> SaleOut:
    sale, created = service.post_sale(db, payload, user.id)
    if not created:
        response.status_code = status.HTTP_200_OK
    return sale


@router.post("/{sale_id}/cancel", response_model=SaleOut)
def cancel_sale(
    sale_id: DbId,
    payload: SaleCancel,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> SaleOut:
    return service.cancel_sale(db, sale_id, payload.reason, user.id)
