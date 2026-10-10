from datetime import UTC, date

from psycopg.errors import UniqueViolation
from sqlalchemy import BigInteger, ColumnElement, cast, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.auth.models import User
from app.customers.models import Customer
from app.customers.service import current_debt
from app.db_utils import local_date_range
from app.debt_adjustments.models import CustomerDebtAdjustment
from app.debt_adjustments.schemas import (
    DebtAdjustmentCreate,
    DebtAdjustmentCustomerOut,
    DebtAdjustmentOut,
    DebtAdjustmentPage,
    DebtAdjustmentStatus,
)
from app.errors import (
    DebtAdjustmentAlreadyCancelledError,
    DebtAdjustmentExceedsDebtError,
    DebtAdjustmentNotFoundError,
    DebtAdjustmentRequestConflictError,
    DocumentCustomerNotFoundError,
)
from app.numbering import next_number

DOC_TYPE = "debt_adjustment"
REQUEST_ID_CONSTRAINT = "uq_customer_debt_adjustments_request_id"
Canceller = aliased(User)


def _debt_adjustment_out(
    row: tuple[CustomerDebtAdjustment, Customer, str, str | None],
) -> DebtAdjustmentOut:
    debt_adjustment, customer, creator, canceller = row
    return DebtAdjustmentOut(
        id=debt_adjustment.id,
        number=debt_adjustment.number,
        request_id=debt_adjustment.request_id,
        customer=DebtAdjustmentCustomerOut(
            id=customer.id, name=customer.name, phone=customer.phone
        ),
        adjusted_at=debt_adjustment.adjusted_at,
        amount=debt_adjustment.amount,
        reason=debt_adjustment.reason,
        status=debt_adjustment.status,
        cancelled_at=debt_adjustment.cancelled_at,
        cancelled_by_name=canceller,
        cancel_reason=debt_adjustment.cancel_reason,
        created_by_name=creator,
        created_at=debt_adjustment.created_at,
    )


def _existing_debt_adjustment(db: Session, data: DebtAdjustmentCreate) -> DebtAdjustmentOut | None:
    debt_adjustment = db.scalar(
        select(CustomerDebtAdjustment).where(CustomerDebtAdjustment.request_id == data.request_id)
    )
    if debt_adjustment is None:
        return None
    same_time = data.adjusted_at is None or debt_adjustment.adjusted_at.astimezone(
        UTC
    ) == data.adjusted_at.astimezone(UTC)
    if (
        debt_adjustment.customer_id != data.customer_id
        or debt_adjustment.amount != data.amount
        or debt_adjustment.reason != data.reason
        or not same_time
    ):
        raise DebtAdjustmentRequestConflictError()
    return get_debt_adjustment(db, debt_adjustment.id)


def _is_request_id_conflict(exc: IntegrityError) -> bool:
    return (
        isinstance(exc.orig, UniqueViolation)
        and exc.orig.diag.constraint_name == REQUEST_ID_CONSTRAINT
    )


def post_debt_adjustment(
    db: Session, data: DebtAdjustmentCreate, user_id: int
) -> tuple[DebtAdjustmentOut, bool]:
    existing = _existing_debt_adjustment(db, data)
    if existing is not None:
        return existing, False
    try:
        customer = db.scalar(
            select(Customer).where(Customer.id == data.customer_id).with_for_update()
        )
        if customer is None:
            raise DocumentCustomerNotFoundError()
        existing = _existing_debt_adjustment(db, data)
        if existing is not None:
            return existing, False
        debt = current_debt(db, data.customer_id)
        if data.amount < 0 and -data.amount > debt:
            raise DebtAdjustmentExceedsDebtError(params={"debt": debt, "amount": data.amount})
        debt_adjustment = CustomerDebtAdjustment(
            number=next_number(db, DOC_TYPE),
            request_id=data.request_id,
            customer_id=data.customer_id,
            amount=data.amount,
            reason=data.reason,
            created_by=user_id,
        )
        if data.adjusted_at is not None:
            debt_adjustment.adjusted_at = data.adjusted_at
        db.add(debt_adjustment)
        db.commit()
    except IntegrityError as exc:
        if not _is_request_id_conflict(exc):
            raise
        db.rollback()
        existing = _existing_debt_adjustment(db, data)
        if existing is None:
            raise
        return existing, False
    return get_debt_adjustment(db, debt_adjustment.id), True


def get_debt_adjustment(db: Session, debt_adjustment_id: int) -> DebtAdjustmentOut:
    row = db.execute(
        select(CustomerDebtAdjustment, Customer, User.full_name, Canceller.full_name)
        .join(Customer, Customer.id == CustomerDebtAdjustment.customer_id)
        .join(User, User.id == CustomerDebtAdjustment.created_by)
        .outerjoin(Canceller, Canceller.id == CustomerDebtAdjustment.cancelled_by)
        .where(CustomerDebtAdjustment.id == debt_adjustment_id)
        .execution_options(populate_existing=True)
    ).one_or_none()
    if row is None:
        raise DebtAdjustmentNotFoundError()
    return _debt_adjustment_out(row)


def list_debt_adjustments(
    db: Session,
    date_from: date | None,
    date_to: date | None,
    customer_id: int | None,
    status: DebtAdjustmentStatus | None,
    limit: int,
    offset: int,
) -> DebtAdjustmentPage:
    conditions: list[ColumnElement[bool]] = local_date_range(
        CustomerDebtAdjustment.adjusted_at, date_from, date_to
    )
    if customer_id is not None:
        conditions.append(CustomerDebtAdjustment.customer_id == customer_id)
    if status is not None:
        conditions.append(CustomerDebtAdjustment.status == status)
    total, sum_posted = db.execute(
        select(
            func.count(),
            cast(
                func.coalesce(
                    func.sum(CustomerDebtAdjustment.amount).filter(
                        CustomerDebtAdjustment.status == "posted"
                    ),
                    0,
                ),
                BigInteger,
            ),
        )
        .select_from(CustomerDebtAdjustment)
        .where(*conditions)
    ).one()
    rows = db.execute(
        select(CustomerDebtAdjustment, Customer, User.full_name, Canceller.full_name)
        .join(Customer, Customer.id == CustomerDebtAdjustment.customer_id)
        .join(User, User.id == CustomerDebtAdjustment.created_by)
        .outerjoin(Canceller, Canceller.id == CustomerDebtAdjustment.cancelled_by)
        .where(*conditions)
        .order_by(CustomerDebtAdjustment.adjusted_at.desc(), CustomerDebtAdjustment.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return DebtAdjustmentPage(
        items=[_debt_adjustment_out(row) for row in rows],
        total=total,
        sum_posted=sum_posted,
    )


def cancel_debt_adjustment(
    db: Session, debt_adjustment_id: int, reason: str, user_id: int
) -> DebtAdjustmentOut:
    customer_id = db.scalar(
        select(CustomerDebtAdjustment.customer_id).where(
            CustomerDebtAdjustment.id == debt_adjustment_id
        )
    )
    if customer_id is None:
        raise DebtAdjustmentNotFoundError()
    db.execute(select(Customer.id).where(Customer.id == customer_id).with_for_update()).scalar_one()
    debt_adjustment = db.scalar(
        select(CustomerDebtAdjustment)
        .where(CustomerDebtAdjustment.id == debt_adjustment_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if debt_adjustment.status == "cancelled":
        raise DebtAdjustmentAlreadyCancelledError()
    debt_adjustment.status = "cancelled"
    debt_adjustment.cancelled_at = func.now()
    debt_adjustment.cancelled_by = user_id
    debt_adjustment.cancel_reason = reason
    db.commit()
    return get_debt_adjustment(db, debt_adjustment.id)
