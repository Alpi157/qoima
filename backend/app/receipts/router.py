from datetime import date

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.auth.dependencies import current_user
from app.auth.models import User
from app.db import get_db
from app.rates.router import get_rate_session_factory
from app.rates.service import SessionFactory
from app.receipts import service
from app.receipts.schemas import (
    ReceiptCancel,
    ReceiptCreate,
    ReceiptDefaultsOut,
    ReceiptOut,
    ReceiptPage,
    ReceiptPreviewIn,
    ReceiptPreviewOut,
    ReceiptStatus,
)
from app.schema_types import DbId

router = APIRouter(prefix="/receipts", tags=["receipts"])


@router.get("", response_model=ReceiptPage)
def list_receipts(
    date_from: date | None = None,
    date_to: date | None = None,
    status: ReceiptStatus | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> ReceiptPage:
    return service.list_receipts(db, date_from, date_to, status, limit, offset)


@router.get("/defaults", response_model=ReceiptDefaultsOut)
def receipt_defaults(
    supplier: str | None = Query(default=None, max_length=255), db: Session = Depends(get_db)
) -> ReceiptDefaultsOut:
    return service.receipt_defaults(db, supplier)


@router.post("/preview", response_model=ReceiptPreviewOut)
def preview_receipt(
    payload: ReceiptPreviewIn,
    db: Session = Depends(get_db),
    session_factory: SessionFactory = Depends(get_rate_session_factory),
) -> ReceiptPreviewOut:
    return service.preview_receipt(db, payload, session_factory=session_factory)


@router.get("/{receipt_id}", response_model=ReceiptOut)
def get_receipt(receipt_id: DbId, db: Session = Depends(get_db)) -> ReceiptOut:
    return service.get_receipt(db, receipt_id)


@router.post(
    "",
    response_model=ReceiptOut,
    status_code=status.HTTP_201_CREATED,
    responses={200: {"model": ReceiptOut, "description": "Приём с этим request_id уже проведён"}},
)
def post_receipt(
    payload: ReceiptCreate,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    session_factory: SessionFactory = Depends(get_rate_session_factory),
) -> ReceiptOut:
    receipt, created = service.post_receipt(db, payload, user.id, session_factory=session_factory)
    if not created:
        response.status_code = status.HTTP_200_OK
    return receipt


@router.post("/{receipt_id}/cancel", response_model=ReceiptOut)
def cancel_receipt(
    receipt_id: DbId,
    payload: ReceiptCancel,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> ReceiptOut:
    return service.cancel_receipt(db, receipt_id, payload.reason, user.id)
