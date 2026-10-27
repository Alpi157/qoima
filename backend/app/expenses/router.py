from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.auth.dependencies import current_user
from app.auth.models import User
from app.db import get_db
from app.expenses import service
from app.expenses.schemas import (
    ExpenseBatch,
    ExpenseCancel,
    ExpenseCategory,
    ExpenseCreate,
    ExpenseOut,
    ExpensePage,
    ExpenseStatus,
)
from app.schema_types import DbId

router = APIRouter(prefix="/expenses", tags=["expenses"])


@router.post(
    "", response_model=ExpenseBatch, status_code=201, responses={200: {"model": ExpenseBatch}}
)
def post_expenses(
    payload: ExpenseCreate,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> ExpenseBatch:
    result, created = service.post_expenses(db, payload, user.id)
    if not created:
        response.status_code = 200
    return result


@router.get("", response_model=ExpensePage)
def list_expenses(
    date_from: Annotated[date, Query(alias="from")],
    date_to: Annotated[date, Query(alias="to")],
    category: Annotated[list[ExpenseCategory] | None, Query()] = None,
    status: ExpenseStatus | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> ExpensePage:
    return service.list_expenses(db, date_from, date_to, category or [], status, limit, offset)


@router.get("/{expense_id}", response_model=ExpenseOut)
def get_expense(expense_id: DbId, db: Session = Depends(get_db)) -> ExpenseOut:
    return service.get_expense(db, expense_id)


@router.post("/{expense_id}/cancel", response_model=ExpenseOut)
def cancel_expense(
    expense_id: DbId,
    payload: ExpenseCancel,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> ExpenseOut:
    return service.cancel_expense(db, expense_id, payload.reason, user.id)
