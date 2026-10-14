import uuid
from collections import Counter
from datetime import date

from fastapi.exceptions import RequestValidationError
from psycopg.errors import UniqueViolation
from sqlalchemy import BigInteger, ColumnElement, case, cast, func, literal, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.auth.models import User
from app.catalog.models import Product
from app.catalog.service import load_line_products
from app.customers.models import Customer
from app.customers.service import fifo_debt_source
from app.db_utils import local_date_range
from app.errors import (
    AmountTooLargeError,
    DebtRequiresCustomerError,
    DocumentCustomerNotFoundError,
    PaidExceedsTotalError,
    SaleAlreadyCancelledError,
    SaleHasReturnsError,
    SaleNotFoundError,
    SaleRequestConflictError,
)
from app.inventory.service import MovementIn, post_movements
from app.numbering import next_number
from app.returns.models import SaleReturn, SaleReturnLine
from app.sales.models import Sale, SaleLine
from app.sales.schemas import (
    SaleCreate,
    SaleCustomerOut,
    SaleLineOut,
    SaleListItem,
    SaleOut,
    SalePage,
    SalePaymentFilter,
    SaleReturnSummary,
    SaleStatus,
)
from app.schema_types import MAX_MONEY, PaymentMethod

DOC_TYPE = "sale"
REQUEST_ID_CONSTRAINT = "uq_sales_request_id"


def find_sale_by_request_id(db: Session, request_id: uuid.UUID) -> Sale | None:
    return db.execute(select(Sale).where(Sale.request_id == request_id)).scalar_one_or_none()


def _payment_method(paid: int, requested: PaymentMethod | None) -> PaymentMethod | None:
    if paid == 0 and requested is not None:
        raise RequestValidationError(
            [
                {
                    "type": "payment_method_without_payment",
                    "loc": ("body", "payment_method"),
                    "msg": "Способ оплаты можно указать только при оплате больше нуля",
                    "input": requested,
                }
            ]
        )
    return (requested or "cash") if paid > 0 else None


def _existing_sale(db: Session, data: SaleCreate) -> SaleOut | None:
    """Return a matching sale using only the explicit prices from the request."""
    sale = find_sale_by_request_id(db, data.request_id)
    if sale is None:
        return None

    stored = db.execute(
        select(SaleLine.product_id, SaleLine.qty, SaleLine.unit_price).where(
            SaleLine.sale_id == sale.id
        )
    ).all()
    requested = [(line.product_id, line.qty, line.unit_price) for line in data.lines]
    paid = sale.total if data.paid_amount is None else data.paid_amount
    payment_method = _payment_method(paid, data.payment_method)
    if (
        sale.customer_id != data.customer_id
        or Counter(map(tuple, stored)) != Counter(requested)
        or sale.paid_at_sale != paid
        or sale.payment_method != payment_method
    ):
        raise SaleRequestConflictError()
    return get_sale(db, sale.id)


def _is_request_id_conflict(exc: IntegrityError) -> bool:
    return (
        isinstance(exc.orig, UniqueViolation)
        and exc.orig.diag.constraint_name == REQUEST_ID_CONSTRAINT
    )


def _create_sale(db: Session, data: SaleCreate, user_id: int) -> Sale:
    if data.customer_id is not None:
        customer = db.execute(
            select(Customer).where(Customer.id == data.customer_id).with_for_update()
        ).scalar_one_or_none()
        if customer is None:
            raise DocumentCustomerNotFoundError()

    load_line_products(db, [line.product_id for line in data.lines], "sale")

    sale_lines = [
        SaleLine(
            product_id=line.product_id,
            qty=line.qty,
            unit_price=line.unit_price,
            line_total=line.qty * line.unit_price,
        )
        for line in data.lines
    ]
    total = sum(line.line_total for line in sale_lines)
    if any(line.line_total > MAX_MONEY for line in sale_lines) or total > MAX_MONEY:
        raise AmountTooLargeError()
    paid = total if data.paid_amount is None else data.paid_amount
    payment_method = _payment_method(paid, data.payment_method)
    if paid > total:
        raise PaidExceedsTotalError(params={"total": total, "paid": paid})
    if paid < total and data.customer_id is None:
        raise DebtRequiresCustomerError()
    sale = Sale(
        number=next_number(db, DOC_TYPE),
        request_id=data.request_id,
        customer_id=data.customer_id,
        note=data.note,
        total=total,
        paid_at_sale=paid,
        payment_method=payment_method,
        created_by=user_id,
    )
    if data.sold_at is not None:
        sale.sold_at = data.sold_at
    db.add(sale)
    db.flush()

    for line in sale_lines:
        line.sale_id = sale.id
    movements = post_movements(
        db,
        [
            MovementIn(line.product_id, -line.qty, "sale", doc_type=DOC_TYPE, doc_id=sale.id)
            for line in data.lines
        ],
        user_id,
    )
    for line, movement in zip(sale_lines, movements, strict=True):
        line.unit_cost = movement.unit_cost
    db.add_all(sale_lines)
    return sale


def post_sale(db: Session, data: SaleCreate, user_id: int) -> tuple[SaleOut, bool]:
    """Post a sale. Returns the sale and True if it was created, False if it already existed."""
    existing = _existing_sale(db, data)
    if existing is not None:
        return existing, False

    try:
        sale = _create_sale(db, data, user_id)
        db.commit()
    except IntegrityError as exc:
        # A concurrent request with the same request_id committed first.
        if not _is_request_id_conflict(exc):
            raise
        db.rollback()
        existing = _existing_sale(db, data)
        if existing is None:
            raise
        return existing, False
    return get_sale(db, sale.id), True


# The user who cancelled a document; a second alias of users next to the author.
Canceller = aliased(User)


def _payment_source():
    outstanding = fifo_debt_source()
    invoices = select(outstanding).where(outstanding.c.kind == "sale").subquery()
    return (
        select(
            Sale.id.label("sale_id"),
            invoices.c.outstanding,
            case(
                (Sale.status == "cancelled", None),
                (invoices.c.net_total == 0, literal("returned")),
                (invoices.c.outstanding == 0, literal("paid")),
                (invoices.c.outstanding >= invoices.c.net_total, literal("unpaid")),
                else_=literal("partial"),
            ).label("payment_status"),
        )
        .outerjoin(invoices, invoices.c.id == Sale.id)
        .subquery()
    )


def get_sale(db: Session, sale_id: int) -> SaleOut:
    payment = _payment_source()
    row = db.execute(
        select(
            Sale,
            User.full_name,
            Canceller.full_name,
            Customer,
            payment.c.outstanding,
            payment.c.payment_status,
        )
        .join(User, User.id == Sale.created_by)
        .outerjoin(Canceller, Canceller.id == Sale.cancelled_by)
        .outerjoin(Customer, Customer.id == Sale.customer_id)
        .join(payment, payment.c.sale_id == Sale.id)
        .where(Sale.id == sale_id)
        .execution_options(populate_existing=True)
    ).one_or_none()
    if row is None:
        raise SaleNotFoundError()
    sale, created_by_name, cancelled_by_name, customer, outstanding, payment_status = row

    returned = (
        select(SaleReturnLine.sale_line_id, func.sum(SaleReturnLine.qty).label("qty"))
        .join(SaleReturn, SaleReturn.id == SaleReturnLine.return_id)
        .where(SaleReturn.status == "posted", SaleReturn.sale_id == sale_id)
        .group_by(SaleReturnLine.sale_line_id)
        .subquery()
    )
    lines = [
        SaleLineOut(
            id=line.id,
            returned_qty=returned_qty,
            product_id=line.product_id,
            article=article,
            name=name,
            unit=unit,
            qty=line.qty,
            unit_price=line.unit_price,
            unit_cost=line.unit_cost,
            line_total=line.line_total,
        )
        for line, article, name, unit, returned_qty in db.execute(
            select(
                SaleLine,
                Product.article,
                Product.name,
                Product.unit,
                func.coalesce(returned.c.qty, 0),
            )
            .join(Product, Product.id == SaleLine.product_id)
            .outerjoin(returned, returned.c.sale_line_id == SaleLine.id)
            .where(SaleLine.sale_id == sale.id)
            .order_by(SaleLine.id)
        ).all()
    ]

    return SaleOut(
        id=sale.id,
        number=sale.number,
        request_id=sale.request_id,
        sold_at=sale.sold_at,
        customer=(
            SaleCustomerOut(id=customer.id, name=customer.name, phone=customer.phone)
            if customer is not None
            else None
        ),
        note=sale.note,
        status=sale.status,
        cancelled_at=sale.cancelled_at,
        cancel_reason=sale.cancel_reason,
        cancelled_by_name=cancelled_by_name,
        created_by_name=created_by_name,
        created_at=sale.created_at,
        lines=lines,
        total=sale.total,
        paid_at_sale=sale.paid_at_sale,
        payment_method=sale.payment_method,
        debt_at_sale=sale.total - sale.paid_at_sale,
        outstanding=outstanding,
        payment_status=payment_status,
        returns=[
            SaleReturnSummary.model_validate(document, from_attributes=True)
            for document in db.scalars(
                select(SaleReturn)
                .where(SaleReturn.sale_id == sale.id)
                .order_by(SaleReturn.returned_at, SaleReturn.id)
            )
        ],
    )


def list_sales(
    db: Session,
    date_from: date | None,
    date_to: date | None,
    customer_id: int | None,
    status: SaleStatus | None,
    limit: int,
    offset: int,
    payment_status: SalePaymentFilter | None = None,
) -> SalePage:
    payment = _payment_source()
    conditions: list[ColumnElement[bool]] = local_date_range(Sale.sold_at, date_from, date_to)
    if customer_id is not None:
        conditions.append(Sale.customer_id == customer_id)
    if status is not None:
        conditions.append(Sale.status == status)
    if payment_status == "open":
        conditions.append(payment.c.payment_status.in_(("unpaid", "partial")))
    elif payment_status is not None:
        conditions.append(payment.c.payment_status == payment_status)

    total, sum_posted = db.execute(
        select(
            func.count(),
            # sum() of bigint is numeric in PostgreSQL: cast back to bigint.
            cast(
                func.coalesce(func.sum(Sale.total).filter(Sale.status == "posted"), 0), BigInteger
            ),
        )
        .select_from(Sale)
        .join(payment, payment.c.sale_id == Sale.id)
        .where(*conditions)
    ).one()

    totals = (
        select(
            SaleLine.sale_id,
            func.count().label("lines_count"),
            cast(func.sum(SaleLine.qty), BigInteger).label("total_qty"),
        )
        .group_by(SaleLine.sale_id)
        .subquery()
    )
    rows = db.execute(
        select(
            Sale.id,
            Sale.number,
            Sale.sold_at,
            Customer.name.label("customer_name"),
            Sale.status,
            totals.c.lines_count,
            totals.c.total_qty,
            Sale.total,
            Sale.paid_at_sale,
            Sale.payment_method,
            (Sale.total - Sale.paid_at_sale).label("debt_at_sale"),
            payment.c.outstanding,
            payment.c.payment_status,
        )
        .join(payment, payment.c.sale_id == Sale.id)
        .join(totals, totals.c.sale_id == Sale.id)
        .outerjoin(Customer, Customer.id == Sale.customer_id)
        .where(*conditions)
        .order_by(Sale.sold_at.desc(), Sale.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    items = [SaleListItem.model_validate(row, from_attributes=True) for row in rows]
    return SalePage(items=items, total=total, sum_posted=sum_posted)


def cancel_sale(db: Session, sale_id: int, reason: str, user_id: int) -> SaleOut:
    customer_id = db.scalar(select(Sale.customer_id).where(Sale.id == sale_id))
    if customer_id is not None:
        db.execute(
            select(Customer.id).where(Customer.id == customer_id).with_for_update()
        ).scalar_one()
    sale = db.execute(
        select(Sale)
        .where(Sale.id == sale_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if sale is None:
        raise SaleNotFoundError()
    if sale.status == "cancelled":
        raise SaleAlreadyCancelledError()
    if (
        db.scalar(
            select(SaleReturn.id)
            .where(SaleReturn.sale_id == sale.id, SaleReturn.status == "posted")
            .limit(1)
        )
        is not None
    ):
        raise SaleHasReturnsError()

    lines = db.execute(
        select(SaleLine).where(SaleLine.sale_id == sale.id).order_by(SaleLine.id)
    ).scalars()
    post_movements(
        db,
        [
            MovementIn(
                line.product_id,
                line.qty,
                "sale_cancel",
                doc_type=DOC_TYPE,
                doc_id=sale.id,
                note=reason,
                unit_cost=line.unit_cost,
            )
            for line in lines
        ],
        user_id,
    )

    sale.status = "cancelled"
    sale.cancelled_at = func.now()
    sale.cancelled_by = user_id
    sale.cancel_reason = reason
    db.commit()
    return get_sale(db, sale.id)
