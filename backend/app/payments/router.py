from datetime import date

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.auth.dependencies import current_user
from app.auth.models import User
from app.db import get_db
from app.payments import service
from app.payments.schemas import (
    PaymentCancel,
    PaymentCreate,
    PaymentOut,
    PaymentPage,
    PaymentStatus,
)
from app.schema_types import DbId

router = APIRouter(prefix="/payments", tags=["payments"])


@router.get("", response_model=PaymentPage)
def list_payments(
    date_from: date | None = Query(None, alias="from"),
    date_to: date | None = Query(None, alias="to"),
    customer_id: DbId | None = None,
    status: PaymentStatus | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> PaymentPage:
    return service.list_payments(db, date_from, date_to, customer_id, status, limit, offset)


@router.get("/{payment_id}", response_model=PaymentOut)
def get_payment(payment_id: DbId, db: Session = Depends(get_db)) -> PaymentOut:
    return service.get_payment(db, payment_id)


@router.post(
    "",
    response_model=PaymentOut,
    status_code=status.HTTP_201_CREATED,
    responses={status.HTTP_200_OK: {"model": PaymentOut}},
)
def post_payment(
    payload: PaymentCreate,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> PaymentOut:
    payment, created = service.post_payment(db, payload, user.id)
    if not created:
        response.status_code = status.HTTP_200_OK
    return payment


@router.post("/{payment_id}/cancel", response_model=PaymentOut)
def cancel_payment(
    payment_id: DbId,
    payload: PaymentCancel,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> PaymentOut:
    return service.cancel_payment(db, payment_id, payload.reason, user.id)
