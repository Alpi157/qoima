from collections import Counter
from datetime import UTC, date, datetime

from fastapi.exceptions import RequestValidationError
from psycopg.errors import UniqueViolation
from sqlalchemy import BigInteger, cast, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.auth.models import User
from app.catalog.models import Product
from app.customers.models import Customer
from app.customers.service import current_debt
from app.db_utils import local_date_range
from app.errors import (
    DuplicateLineError,
    InsufficientStockError,
    ReturnAlreadyCancelledError,
    ReturnCancelBlockedError,
    ReturnNotFoundError,
    ReturnQtyExceedsSoldError,
    ReturnRequestConflictError,
    SaleNotFoundError,
    SaleNotPostedError,
)
from app.inventory.service import MovementIn, post_movements
from app.numbering import next_number
from app.returns.models import SaleReturn, SaleReturnLine
from app.returns.schemas import (
    ReturnCreate,
    ReturnCustomerOut,
    ReturnLineOut,
    ReturnListItem,
    ReturnOut,
    ReturnPage,
    ReturnSaleOut,
    ReturnStatus,
)
from app.sales.models import Sale, SaleLine

DOC_TYPE = "return"
REQUEST_ID_CONSTRAINT = "uq_sale_returns_request_id"
Canceller = aliased(User)


def _existing_return(db: Session, data: ReturnCreate) -> ReturnOut | None:
    document = db.scalar(select(SaleReturn).where(SaleReturn.request_id == data.request_id))
    if document is None:
        return None
    stored = db.execute(
        select(SaleReturnLine.sale_line_id, SaleReturnLine.qty, SaleReturnLine.condition).where(
            SaleReturnLine.return_id == document.id
        )
    ).all()
    same_time = data.returned_at is None or document.returned_at.astimezone(
        UTC
    ) == data.returned_at.astimezone(UTC)
    if (
        document.sale_id != data.sale_id
        or document.note != data.note
        or Counter(map(tuple, stored))
        != Counter((line.sale_line_id, line.qty, line.condition) for line in data.lines)
        or not same_time
        or (data.refund_method is not None and data.refund_method != document.refund_method)
    ):
        raise ReturnRequestConflictError()
    return get_return(db, document.id)


def _lock_sale(db: Session, sale_id: int) -> Sale:
    row = db.execute(select(Sale.customer_id).where(Sale.id == sale_id)).one_or_none()
    if row is None:
        raise SaleNotFoundError()
    if row.customer_id is not None:
        db.execute(
            select(Customer.id).where(Customer.id == row.customer_id).with_for_update()
        ).scalar_one()
    return db.execute(
        select(Sale)
        .where(Sale.id == sale_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one()


def _validation(field: tuple, kind: str, message: str, value: object) -> None:
    raise RequestValidationError(
        [{"type": kind, "loc": ("body", *field), "msg": message, "input": value}]
    )


def _create_return(db: Session, data: ReturnCreate, sale: Sale, user_id: int) -> SaleReturn:
    if sale.status != "posted":
        raise SaleNotPostedError()
    returned_at = data.returned_at or datetime.now(UTC)
    if returned_at < sale.sold_at:
        _validation(
            ("returned_at",),
            "returned_at_before_sale",
            "Дата возврата не может быть раньше даты продажи",
            returned_at.isoformat(),
        )
    pairs = db.execute(
        select(SaleLine, Product.article)
        .join(Product, Product.id == SaleLine.product_id)
        .where(SaleLine.sale_id == sale.id)
    ).all()
    by_id = {line.id: (line, article) for line, article in pairs}
    returned = dict(
        db.execute(
            select(SaleReturnLine.sale_line_id, func.sum(SaleReturnLine.qty))
            .join(SaleReturn, SaleReturn.id == SaleReturnLine.return_id)
            .where(SaleReturn.sale_id == sale.id, SaleReturn.status == "posted")
            .group_by(SaleReturnLine.sale_line_id)
        ).all()
    )
    seen = set()
    lines = []
    for index, requested in enumerate(data.lines):
        if requested.sale_line_id not in by_id:
            _validation(
                ("lines", index, "sale_line_id"),
                "sale_line_not_in_sale",
                "Строка не принадлежит указанной продаже",
                requested.sale_line_id,
            )
        line, article = by_id[requested.sale_line_id]
        if line.id in seen:
            raise DuplicateLineError(
                f"Товар {article} указан в возврате дважды",
                {"article": article, "document": "return"},
            )
        seen.add(line.id)
        previous = returned.get(line.id, 0)
        if requested.qty > line.qty - previous:
            params = {
                "article": article,
                "sold": line.qty,
                "returned": previous,
                "requested": requested.qty,
            }
            raise ReturnQtyExceedsSoldError(
                f"{article}: продано {line.qty}, уже возвращено {previous}. "
                f"Вернуть {requested.qty} нельзя.",
                params,
            )
        lines.append(
            SaleReturnLine(
                sale_line_id=line.id,
                product_id=line.product_id,
                qty=requested.qty,
                unit_price=line.unit_price,
                unit_cost=line.unit_cost,
                line_total=requested.qty * line.unit_price,
                condition=requested.condition,
            )
        )
    total = sum(line.line_total for line in lines)
    debt = current_debt(db, sale.customer_id) if sale.customer_id is not None else 0
    credit = min(total, max(debt, 0))
    refund = total - credit
    if refund == 0 and data.refund_method is not None:
        _validation(
            ("refund_method",),
            "refund_method_without_refund",
            "Способ возврата денег можно указать только при сумме больше нуля",
            data.refund_method,
        )
    document = SaleReturn(
        number=next_number(db, DOC_TYPE),
        request_id=data.request_id,
        sale_id=sale.id,
        customer_id=sale.customer_id,
        returned_at=returned_at,
        total=total,
        debt_credit=credit,
        refund_amount=refund,
        refund_method=(data.refund_method or "cash") if refund else None,
        note=data.note,
        created_by=user_id,
    )
    db.add(document)
    db.flush()
    for line in lines:
        line.return_id = document.id
    db.add_all(lines)
    post_movements(
        db,
        [
            MovementIn(
                line.product_id,
                line.qty,
                "return",
                doc_type=DOC_TYPE,
                doc_id=document.id,
                unit_cost=line.unit_cost,
            )
            for line in lines
            if line.condition == "good"
        ],
        user_id,
    )
    return document


def post_return(db: Session, data: ReturnCreate, user_id: int) -> tuple[ReturnOut, bool]:
    existing = _existing_return(db, data)
    if existing is not None:
        return existing, False
    try:
        sale = _lock_sale(db, data.sale_id)
        # A replay may have waited for the first request to commit its document.
        existing = _existing_return(db, data)
        if existing is not None:
            return existing, False
        document = _create_return(db, data, sale, user_id)
        db.commit()
    except IntegrityError as exc:
        if not (
            isinstance(exc.orig, UniqueViolation)
            and exc.orig.diag.constraint_name == REQUEST_ID_CONSTRAINT
        ):
            raise
        db.rollback()
        existing = _existing_return(db, data)
        if existing is None:
            raise
        return existing, False
    return get_return(db, document.id), True


def _headers():
    return (
        select(SaleReturn, Sale.number, Customer, User.full_name, Canceller.full_name)
        .join(Sale, Sale.id == SaleReturn.sale_id)
        .outerjoin(Customer, Customer.id == SaleReturn.customer_id)
        .join(User, User.id == SaleReturn.created_by)
        .outerjoin(Canceller, Canceller.id == SaleReturn.cancelled_by)
        .execution_options(populate_existing=True)
    )


def _header_out(row) -> ReturnListItem:
    document, sale_number, customer, creator, canceller = row
    return ReturnListItem(
        id=document.id,
        number=document.number,
        request_id=document.request_id,
        sale=ReturnSaleOut(id=document.sale_id, number=sale_number),
        customer=ReturnCustomerOut(id=customer.id, name=customer.name, phone=customer.phone)
        if customer
        else None,
        returned_at=document.returned_at,
        total=document.total,
        debt_credit=document.debt_credit,
        refund_amount=document.refund_amount,
        refund_method=document.refund_method,
        note=document.note,
        status=document.status,
        cancelled_at=document.cancelled_at,
        cancelled_by_name=canceller,
        cancel_reason=document.cancel_reason,
        created_by_name=creator,
        created_at=document.created_at,
    )


def get_return(db: Session, return_id: int) -> ReturnOut:
    row = db.execute(_headers().where(SaleReturn.id == return_id)).one_or_none()
    if row is None:
        raise ReturnNotFoundError()
    lines = [
        ReturnLineOut(
            id=line.id,
            sale_line_id=line.sale_line_id,
            product_id=line.product_id,
            article=article,
            name=name,
            unit=unit,
            qty=line.qty,
            unit_price=line.unit_price,
            line_total=line.line_total,
            unit_cost=line.unit_cost,
            condition=line.condition,
        )
        for line, article, name, unit in db.execute(
            select(SaleReturnLine, Product.article, Product.name, Product.unit)
            .join(Product, Product.id == SaleReturnLine.product_id)
            .where(SaleReturnLine.return_id == return_id)
            .order_by(SaleReturnLine.id)
        ).all()
    ]
    return ReturnOut(**_header_out(row).model_dump(), lines=lines)


def list_returns(
    db: Session,
    sale_id: int | None,
    customer_id: int | None,
    date_from: date | None,
    date_to: date | None,
    status: ReturnStatus | None,
    limit: int,
    offset: int,
) -> ReturnPage:
    conditions = local_date_range(SaleReturn.returned_at, date_from, date_to)
    if sale_id is not None:
        conditions.append(SaleReturn.sale_id == sale_id)
    if customer_id is not None:
        conditions.append(SaleReturn.customer_id == customer_id)
    if status is not None:
        conditions.append(SaleReturn.status == status)
    total, sum_posted = db.execute(
        select(
            func.count(),
            cast(
                func.coalesce(func.sum(SaleReturn.total).filter(SaleReturn.status == "posted"), 0),
                BigInteger,
            ),
        )
        .select_from(SaleReturn)
        .where(*conditions)
    ).one()
    rows = db.execute(
        _headers()
        .where(*conditions)
        .order_by(SaleReturn.returned_at.desc(), SaleReturn.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return ReturnPage(items=[_header_out(row) for row in rows], total=total, sum_posted=sum_posted)


def cancel_return(db: Session, return_id: int, reason: str, user_id: int) -> ReturnOut:
    sale_id = db.scalar(select(SaleReturn.sale_id).where(SaleReturn.id == return_id))
    if sale_id is None:
        raise ReturnNotFoundError()
    _lock_sale(db, sale_id)
    document = db.scalar(
        select(SaleReturn)
        .where(SaleReturn.id == return_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if document.status == "cancelled":
        raise ReturnAlreadyCancelledError()
    lines = db.scalars(
        select(SaleReturnLine)
        .where(SaleReturnLine.return_id == return_id)
        .order_by(SaleReturnLine.id)
    ).all()
    try:
        post_movements(
            db,
            [
                MovementIn(
                    line.product_id,
                    -line.qty,
                    "return_cancel",
                    doc_type=DOC_TYPE,
                    doc_id=return_id,
                    note=reason,
                    unit_cost=line.unit_cost,
                )
                for line in lines
                if line.condition == "good"
            ],
            user_id,
        )
    except InsufficientStockError as exc:
        raise ReturnCancelBlockedError(params=exc.params) from exc
    document.status = "cancelled"
    document.cancelled_at = func.now()
    document.cancelled_by = user_id
    document.cancel_reason = reason
    db.commit()
    return get_return(db, return_id)
