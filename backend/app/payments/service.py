from datetime import UTC, date

from psycopg.errors import UniqueViolation
from sqlalchemy import BigInteger, ColumnElement, cast, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.auth.models import User
from app.customers.models import Customer
from app.customers.service import current_debt
from app.db_utils import local_date_range
from app.errors import (
    DocumentCustomerNotFoundError,
    PaymentAlreadyCancelledError,
    PaymentExceedsDebtError,
    PaymentNotFoundError,
    PaymentRequestConflictError,
)
from app.numbering import next_number
from app.payments.models import CustomerPayment
from app.payments.schemas import (
    PaymentCreate,
    PaymentCustomerOut,
    PaymentOut,
    PaymentPage,
    PaymentStatus,
)

DOC_TYPE = "payment"
REQUEST_ID_CONSTRAINT = "uq_customer_payments_request_id"
Canceller = aliased(User)


def _payment_out(row: tuple[CustomerPayment, Customer, str, str | None]) -> PaymentOut:
    payment, customer, creator, canceller = row
    return PaymentOut(
        id=payment.id,
        number=payment.number,
        request_id=payment.request_id,
        customer=PaymentCustomerOut(id=customer.id, name=customer.name, phone=customer.phone),
        paid_at=payment.paid_at,
        amount=payment.amount,
        payment_method=payment.payment_method,
        note=payment.note,
        status=payment.status,
        cancelled_at=payment.cancelled_at,
        cancelled_by_name=canceller,
        cancel_reason=payment.cancel_reason,
        created_by_name=creator,
        created_at=payment.created_at,
    )


def _existing_payment(db: Session, data: PaymentCreate) -> PaymentOut | None:
    payment = db.scalar(
        select(CustomerPayment).where(CustomerPayment.request_id == data.request_id)
    )
    if payment is None:
        return None
    same_time = data.paid_at is None or payment.paid_at.astimezone(UTC) == data.paid_at.astimezone(
        UTC
    )
    if (
        payment.customer_id != data.customer_id
        or payment.amount != data.amount
        or payment.payment_method != data.payment_method
        or payment.note != data.note
        or not same_time
    ):
        raise PaymentRequestConflictError()
    return get_payment(db, payment.id)


def _is_request_id_conflict(exc: IntegrityError) -> bool:
    return (
        isinstance(exc.orig, UniqueViolation)
        and exc.orig.diag.constraint_name == REQUEST_ID_CONSTRAINT
    )


def post_payment(db: Session, data: PaymentCreate, user_id: int) -> tuple[PaymentOut, bool]:
    existing = _existing_payment(db, data)
    if existing is not None:
        return existing, False
    try:
        customer = db.scalar(
            select(Customer).where(Customer.id == data.customer_id).with_for_update()
        )
        if customer is None:
            raise DocumentCustomerNotFoundError()
        existing = _existing_payment(db, data)
        if existing is not None:
            return existing, False
        debt = current_debt(db, data.customer_id)
        if data.amount > debt:
            raise PaymentExceedsDebtError(params={"debt": debt, "amount": data.amount})
        payment = CustomerPayment(
            number=next_number(db, DOC_TYPE),
            request_id=data.request_id,
            customer_id=data.customer_id,
            amount=data.amount,
            payment_method=data.payment_method,
            note=data.note,
            created_by=user_id,
        )
        if data.paid_at is not None:
            payment.paid_at = data.paid_at
        db.add(payment)
        db.commit()
    except IntegrityError as exc:
        if not _is_request_id_conflict(exc):
            raise
        db.rollback()
        existing = _existing_payment(db, data)
        if existing is None:
            raise
        return existing, False
    return get_payment(db, payment.id), True


def get_payment(db: Session, payment_id: int) -> PaymentOut:
    row = db.execute(
        select(CustomerPayment, Customer, User.full_name, Canceller.full_name)
        .join(Customer, Customer.id == CustomerPayment.customer_id)
        .join(User, User.id == CustomerPayment.created_by)
        .outerjoin(Canceller, Canceller.id == CustomerPayment.cancelled_by)
        .where(CustomerPayment.id == payment_id)
        .execution_options(populate_existing=True)
    ).one_or_none()
    if row is None:
        raise PaymentNotFoundError()
    return _payment_out(row)


def list_payments(
    db: Session,
    date_from: date | None,
    date_to: date | None,
    customer_id: int | None,
    status: PaymentStatus | None,
    limit: int,
    offset: int,
) -> PaymentPage:
    conditions: list[ColumnElement[bool]] = local_date_range(
        CustomerPayment.paid_at, date_from, date_to
    )
    if customer_id is not None:
        conditions.append(CustomerPayment.customer_id == customer_id)
    if status is not None:
        conditions.append(CustomerPayment.status == status)
    total, sum_posted = db.execute(
        select(
            func.count(),
            cast(
                func.coalesce(
                    func.sum(CustomerPayment.amount).filter(CustomerPayment.status == "posted"), 0
                ),
                BigInteger,
            ),
        )
        .select_from(CustomerPayment)
        .where(*conditions)
    ).one()
    rows = db.execute(
        select(CustomerPayment, Customer, User.full_name, Canceller.full_name)
        .join(Customer, Customer.id == CustomerPayment.customer_id)
        .join(User, User.id == CustomerPayment.created_by)
        .outerjoin(Canceller, Canceller.id == CustomerPayment.cancelled_by)
        .where(*conditions)
        .order_by(CustomerPayment.paid_at.desc(), CustomerPayment.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return PaymentPage(
        items=[_payment_out(row) for row in rows],
        total=total,
        sum_posted=sum_posted,
    )


def cancel_payment(db: Session, payment_id: int, reason: str, user_id: int) -> PaymentOut:
    customer_id = db.scalar(
        select(CustomerPayment.customer_id).where(CustomerPayment.id == payment_id)
    )
    if customer_id is None:
        raise PaymentNotFoundError()
    db.execute(select(Customer.id).where(Customer.id == customer_id).with_for_update()).scalar_one()
    payment = db.scalar(
        select(CustomerPayment)
        .where(CustomerPayment.id == payment_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if payment.status == "cancelled":
        raise PaymentAlreadyCancelledError()
    payment.status = "cancelled"
    payment.cancelled_at = func.now()
    payment.cancelled_by = user_id
    payment.cancel_reason = reason
    db.commit()
    return get_payment(db, payment.id)
