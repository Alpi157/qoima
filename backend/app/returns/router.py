from datetime import date

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.auth.dependencies import current_user
from app.auth.models import User
from app.db import get_db
from app.returns import service
from app.returns.schemas import ReturnCancel, ReturnCreate, ReturnOut, ReturnPage, ReturnStatus
from app.schema_types import DbId

router = APIRouter(prefix="/returns", tags=["returns"])


@router.get("", response_model=ReturnPage)
def list_returns(
    sale_id: DbId | None = None,
    customer_id: DbId | None = None,
    date_from: date | None = Query(None, alias="from"),
    date_to: date | None = Query(None, alias="to"),
    status: ReturnStatus | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> ReturnPage:
    return service.list_returns(db, sale_id, customer_id, date_from, date_to, status, limit, offset)


@router.get("/{return_id}", response_model=ReturnOut)
def get_return(return_id: DbId, db: Session = Depends(get_db)) -> ReturnOut:
    return service.get_return(db, return_id)


@router.post(
    "",
    response_model=ReturnOut,
    status_code=status.HTTP_201_CREATED,
    responses={status.HTTP_200_OK: {"model": ReturnOut}},
)
def post_return(
    payload: ReturnCreate,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> ReturnOut:
    document, created = service.post_return(db, payload, user.id)
    if not created:
        response.status_code = status.HTTP_200_OK
    return document


@router.post("/{return_id}/cancel", response_model=ReturnOut)
def cancel_return(
    return_id: DbId,
    payload: ReturnCancel,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> ReturnOut:
    return service.cancel_return(db, return_id, payload.reason, user.id)
