from datetime import date

from psycopg.errors import UniqueViolation
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.auth.models import User
from app.db_utils import lock_request_id
from app.errors import (
    ExpenseAlreadyCancelledError,
    ExpenseNotFoundError,
    ExpenseRequestConflictError,
)
from app.expenses.models import Expense
from app.expenses.schemas import (
    ExpenseBatch,
    ExpenseCategory,
    ExpenseCreate,
    ExpenseOut,
    ExpensePage,
    ExpenseStatus,
)
from app.numbering import next_number
from app.reports.service import validate_period

EXPENSE_REQUEST_LOCK = 2204
REQUEST_ID_CONSTRAINT = "uq_expenses_request_id_request_index"
Canceller = aliased(User)


def _query():
    return (
        select(Expense, User.full_name, Canceller.full_name)
        .join(User, User.id == Expense.created_by)
        .outerjoin(Canceller, Canceller.id == Expense.cancelled_by)
        .execution_options(populate_existing=True)
    )


def _out(row) -> ExpenseOut:
    expense, creator, canceller = row
    return ExpenseOut(
        **{
            name: getattr(expense, name)
            for name in ExpenseOut.model_fields
            if name not in ("created_by_name", "cancelled_by_name")
        },
        created_by_name=creator,
        cancelled_by_name=canceller,
    )


def _existing(db: Session, data: ExpenseCreate) -> ExpenseBatch | None:
    rows = db.execute(
        _query().where(Expense.request_id == data.request_id).order_by(Expense.request_index)
    ).all()
    if not rows:
        return None
    saved = [(r[0].expense_date, r[0].category, r[0].amount, r[0].note) for r in rows]
    requested = [(i.expense_date, i.category, i.amount, i.note) for i in data.items]
    if saved != requested:
        first = rows[0][0]
        raise ExpenseRequestConflictError(params={"id": first.id, "number": first.number})
    return ExpenseBatch(items=[_out(row) for row in rows])


def post_expenses(db: Session, data: ExpenseCreate, user_id: int) -> tuple[ExpenseBatch, bool]:
    lock_request_id(db, EXPENSE_REQUEST_LOCK, data.request_id)
    existing = _existing(db, data)
    if existing is not None:
        return existing, False
    try:
        for index, item in enumerate(data.items):
            db.add(
                Expense(
                    number=next_number(db, "expense"),
                    request_id=data.request_id,
                    request_index=index,
                    created_by=user_id,
                    **item.model_dump(),
                )
            )
        db.commit()
    except IntegrityError as exc:
        if not (
            isinstance(exc.orig, UniqueViolation)
            and exc.orig.diag.constraint_name == REQUEST_ID_CONSTRAINT
        ):
            raise
        db.rollback()
        existing = _existing(db, data)
        if existing is None:
            raise
        return existing, False
    return _existing(db, data), True


def get_expense(db: Session, expense_id: int) -> ExpenseOut:
    row = db.execute(_query().where(Expense.id == expense_id)).one_or_none()
    if row is None:
        raise ExpenseNotFoundError()
    return _out(row)


def list_expenses(
    db: Session,
    date_from: date,
    date_to: date,
    categories: list[ExpenseCategory],
    status: ExpenseStatus | None,
    limit: int,
    offset: int,
) -> ExpensePage:
    validate_period(date_from, date_to)
    conditions = [Expense.expense_date >= date_from, Expense.expense_date <= date_to]
    if categories:
        conditions.append(Expense.category.in_(categories))
    if status is not None:
        conditions.append(Expense.status == status)
    total, amount = db.execute(
        select(
            func.count(),
            func.coalesce(func.sum(Expense.amount).filter(Expense.status == "posted"), 0),
        ).where(*conditions)
    ).one()
    rows = db.execute(
        _query()
        .where(*conditions)
        .order_by(Expense.expense_date.desc(), Expense.number.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return ExpensePage(items=[_out(row) for row in rows], total=total, posted_amount=int(amount))


def cancel_expense(db: Session, expense_id: int, reason: str, user_id: int) -> ExpenseOut:
    expense = db.scalar(
        select(Expense)
        .where(Expense.id == expense_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if expense is None:
        raise ExpenseNotFoundError()
    if expense.status == "cancelled":
        raise ExpenseAlreadyCancelledError()
    expense.status = "cancelled"
    expense.cancelled_at = func.now()
    expense.cancelled_by = user_id
    expense.cancel_reason = reason
    db.commit()
    return get_expense(db, expense_id)
