import uuid
from collections import Counter
from datetime import date

from psycopg.errors import UniqueViolation
from sqlalchemy import BigInteger, ColumnElement, cast, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.auth.models import User
from app.catalog.models import Product
from app.catalog.service import load_line_products
from app.customers.models import Customer
from app.db_utils import local_date_range
from app.errors import (
    DocumentCustomerNotFoundError,
    InvalidDocumentLinesError,
    SaleAlreadyCancelledError,
    SaleNotFoundError,
    SaleRequestConflictError,
)
from app.inventory.service import MovementIn, post_movements
from app.numbering import next_number
from app.sales.models import Sale, SaleLine
from app.sales.schemas import (
    SaleCreate,
    SaleCustomerOut,
    SaleLineIn,
    SaleLineOut,
    SaleListItem,
    SaleOut,
    SalePage,
    SaleStatus,
)

DOC_TYPE = "sale"
REQUEST_ID_CONSTRAINT = "uq_sales_request_id"


def find_sale_by_request_id(db: Session, request_id: uuid.UUID) -> Sale | None:
    return db.execute(select(Sale).where(Sale.request_id == request_id)).scalar_one_or_none()


def _line_price(line: SaleLineIn, sale_price: int | None) -> int | None:
    """Price the line is sold at: the explicit one, else the product's if it is set."""
    if line.unit_price is not None:
        return line.unit_price
    return sale_price if sale_price else None


def _existing_sale(db: Session, data: SaleCreate) -> SaleOut | None:
    """The sale already posted with this request_id, if its content matches the request.

    Content is the customer and the lines (product_id, qty, unit_price) with prices resolved
    the same way as when posting, so omitting unit_price matches a sale at the product's price.
    """
    sale = find_sale_by_request_id(db, data.request_id)
    if sale is None:
        return None

    stored = db.execute(
        select(SaleLine.product_id, SaleLine.qty, SaleLine.unit_price).where(
            SaleLine.sale_id == sale.id
        )
    ).all()
    sale_prices = dict(
        db.execute(
            select(Product.id, Product.sale_price).where(
                Product.id.in_({line.product_id for line in data.lines})
            )
        ).all()
    )
    requested = [
        (line.product_id, line.qty, _line_price(line, sale_prices.get(line.product_id)))
        for line in data.lines
    ]
    # Counter, not sorted(): a missing price is None and does not compare with int.
    if sale.customer_id != data.customer_id or Counter(map(tuple, stored)) != Counter(requested):
        raise SaleRequestConflictError()
    return get_sale(db, sale.id)


def _is_request_id_conflict(exc: IntegrityError) -> bool:
    return (
        isinstance(exc.orig, UniqueViolation)
        and exc.orig.diag.constraint_name == REQUEST_ID_CONSTRAINT
    )


def _create_sale(db: Session, data: SaleCreate, user_id: int) -> Sale:
    if data.customer_id is not None and db.get(Customer, data.customer_id) is None:
        raise DocumentCustomerNotFoundError()

    products = load_line_products(db, [line.product_id for line in data.lines], "продаже")
    prices = []
    for line in data.lines:
        product = products[line.product_id]
        price = _line_price(line, product.sale_price)
        if price is None:
            raise InvalidDocumentLinesError(f"Укажите цену для товара {product.article}")
        prices.append(price)

    sale_lines = [
        SaleLine(
            product_id=line.product_id,
            qty=line.qty,
            unit_price=price,
            line_total=line.qty * price,
        )
        for line, price in zip(data.lines, prices, strict=True)
    ]
    sale = Sale(
        number=next_number(db, DOC_TYPE),
        request_id=data.request_id,
        customer_id=data.customer_id,
        note=data.note,
        total=sum(line.line_total for line in sale_lines),
        created_by=user_id,
    )
    if data.sold_at is not None:
        sale.sold_at = data.sold_at
    db.add(sale)
    db.flush()

    for line in sale_lines:
        line.sale_id = sale.id
    db.add_all(sale_lines)
    post_movements(
        db,
        [
            MovementIn(line.product_id, -line.qty, "sale", doc_type=DOC_TYPE, doc_id=sale.id)
            for line in data.lines
        ],
        user_id,
    )
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


def get_sale(db: Session, sale_id: int) -> SaleOut:
    row = db.execute(
        select(Sale, User.full_name, Canceller.full_name, Customer)
        .join(User, User.id == Sale.created_by)
        .outerjoin(Canceller, Canceller.id == Sale.cancelled_by)
        .outerjoin(Customer, Customer.id == Sale.customer_id)
        .where(Sale.id == sale_id)
        .execution_options(populate_existing=True)
    ).one_or_none()
    if row is None:
        raise SaleNotFoundError()
    sale, created_by_name, cancelled_by_name, customer = row

    lines = [
        SaleLineOut(
            product_id=line.product_id,
            article=article,
            name=name,
            unit=unit,
            qty=line.qty,
            unit_price=line.unit_price,
            line_total=line.line_total,
        )
        for line, article, name, unit in db.execute(
            select(SaleLine, Product.article, Product.name, Product.unit)
            .join(Product, Product.id == SaleLine.product_id)
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
    )


def list_sales(
    db: Session,
    date_from: date | None,
    date_to: date | None,
    customer_id: int | None,
    status: SaleStatus | None,
    limit: int,
    offset: int,
) -> SalePage:
    conditions: list[ColumnElement[bool]] = local_date_range(Sale.sold_at, date_from, date_to)
    if customer_id is not None:
        conditions.append(Sale.customer_id == customer_id)
    if status is not None:
        conditions.append(Sale.status == status)

    total, sum_posted = db.execute(
        select(
            func.count(),
            # sum() of bigint is numeric in PostgreSQL: cast back to bigint.
            cast(
                func.coalesce(func.sum(Sale.total).filter(Sale.status == "posted"), 0), BigInteger
            ),
        )
        .select_from(Sale)
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
        )
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
