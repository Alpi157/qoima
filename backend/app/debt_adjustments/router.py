from datetime import date

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.auth.dependencies import current_user
from app.auth.models import User
from app.db import get_db
from app.debt_adjustments import service
from app.debt_adjustments.schemas import (
    DebtAdjustmentCancel,
    DebtAdjustmentCreate,
    DebtAdjustmentOut,
    DebtAdjustmentPage,
    DebtAdjustmentStatus,
)
from app.schema_types import DbId

router = APIRouter(prefix="/debt-adjustments", tags=["debt_adjustments"])


@router.get("", response_model=DebtAdjustmentPage)
def list_debt_adjustments(
    date_from: date | None = Query(None, alias="from"),
    date_to: date | None = Query(None, alias="to"),
    customer_id: DbId | None = None,
    status: DebtAdjustmentStatus | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> DebtAdjustmentPage:
    return service.list_debt_adjustments(db, date_from, date_to, customer_id, status, limit, offset)


@router.get("/{debt_adjustment_id}", response_model=DebtAdjustmentOut)
def get_debt_adjustment(
    debt_adjustment_id: DbId, db: Session = Depends(get_db)
) -> DebtAdjustmentOut:
    return service.get_debt_adjustment(db, debt_adjustment_id)


@router.post(
    "",
    response_model=DebtAdjustmentOut,
    status_code=status.HTTP_201_CREATED,
    responses={status.HTTP_200_OK: {"model": DebtAdjustmentOut}},
)
def post_debt_adjustment(
    payload: DebtAdjustmentCreate,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> DebtAdjustmentOut:
    debt_adjustment, created = service.post_debt_adjustment(db, payload, user.id)
    if not created:
        response.status_code = status.HTTP_200_OK
    return debt_adjustment


@router.post("/{debt_adjustment_id}/cancel", response_model=DebtAdjustmentOut)
def cancel_debt_adjustment(
    debt_adjustment_id: DbId,
    payload: DebtAdjustmentCancel,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> DebtAdjustmentOut:
    return service.cancel_debt_adjustment(db, debt_adjustment_id, payload.reason, user.id)
