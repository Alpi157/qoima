from datetime import date

from sqlalchemy import BigInteger, ColumnElement, cast, func, select
from sqlalchemy.orm import Session

from app.auth.models import User
from app.catalog.models import Product
from app.catalog.service import load_line_products
from app.db_utils import local_date_range
from app.errors import (
    InsufficientStockError,
    ReceiptAlreadyCancelledError,
    ReceiptCancelError,
    ReceiptNotFoundError,
)
from app.inventory.service import MovementIn, post_movements
from app.numbering import next_number
from app.receipts.models import Receipt, ReceiptLine
from app.receipts.schemas import (
    ReceiptCreate,
    ReceiptLineOut,
    ReceiptListItem,
    ReceiptOut,
    ReceiptPage,
    ReceiptStatus,
)

DOC_TYPE = "receipt"


def post_receipt(db: Session, data: ReceiptCreate, user_id: int) -> ReceiptOut:
    load_line_products(db, [line.product_id for line in data.lines], "приходе")

    receipt = Receipt(
        number=next_number(db, DOC_TYPE),
        supplier=data.supplier,
        note=data.note,
        created_by=user_id,
    )
    if data.received_at is not None:
        receipt.received_at = data.received_at
    db.add(receipt)
    db.flush()

    db.add_all(
        ReceiptLine(
            receipt_id=receipt.id,
            product_id=line.product_id,
            qty=line.qty,
            unit_cost=line.unit_cost,
        )
        for line in data.lines
    )
    post_movements(
        db,
        [
            MovementIn(line.product_id, line.qty, "receipt", doc_type=DOC_TYPE, doc_id=receipt.id)
            for line in data.lines
        ],
        user_id,
    )
    db.commit()
    return get_receipt(db, receipt.id)


def _total_cost(pairs: list[tuple[int, int | None]]) -> int | None:
    costs = [qty * unit_cost for qty, unit_cost in pairs if unit_cost is not None]
    return sum(costs) if costs else None


def get_receipt(db: Session, receipt_id: int) -> ReceiptOut:
    row = db.execute(
        select(Receipt, User.full_name)
        .join(User, User.id == Receipt.created_by)
        .where(Receipt.id == receipt_id)
        .execution_options(populate_existing=True)
    ).one_or_none()
    if row is None:
        raise ReceiptNotFoundError()
    receipt, created_by_name = row

    lines = [
        ReceiptLineOut(
            product_id=line.product_id,
            article=article,
            name=name,
            qty=line.qty,
            unit_cost=line.unit_cost,
        )
        for line, article, name in db.execute(
            select(ReceiptLine, Product.article, Product.name)
            .join(Product, Product.id == ReceiptLine.product_id)
            .where(ReceiptLine.receipt_id == receipt.id)
            .order_by(ReceiptLine.id)
        ).all()
    ]

    return ReceiptOut(
        id=receipt.id,
        number=receipt.number,
        received_at=receipt.received_at,
        supplier=receipt.supplier,
        note=receipt.note,
        status=receipt.status,
        cancelled_at=receipt.cancelled_at,
        cancel_reason=receipt.cancel_reason,
        created_by_name=created_by_name,
        created_at=receipt.created_at,
        lines=lines,
        total_qty=sum(line.qty for line in lines),
        total_cost=_total_cost([(line.qty, line.unit_cost) for line in lines]),
    )


def list_receipts(
    db: Session,
    date_from: date | None,
    date_to: date | None,
    status: ReceiptStatus | None,
    limit: int,
    offset: int,
) -> ReceiptPage:
    conditions: list[ColumnElement[bool]] = local_date_range(
        Receipt.received_at, date_from, date_to
    )
    if status is not None:
        conditions.append(Receipt.status == status)

    total = db.execute(select(func.count()).select_from(Receipt).where(*conditions)).scalar_one()

    totals = (
        select(
            ReceiptLine.receipt_id,
            func.count().label("lines_count"),
            # sum() of integers is numeric in PostgreSQL: cast back to bigint.
            cast(func.sum(ReceiptLine.qty), BigInteger).label("total_qty"),
            cast(func.sum(ReceiptLine.qty * ReceiptLine.unit_cost), BigInteger).label("total_cost"),
        )
        .group_by(ReceiptLine.receipt_id)
        .subquery()
    )
    rows = db.execute(
        select(
            Receipt.id,
            Receipt.number,
            Receipt.received_at,
            Receipt.supplier,
            Receipt.status,
            totals.c.lines_count,
            totals.c.total_qty,
            totals.c.total_cost,
        )
        .join(totals, totals.c.receipt_id == Receipt.id)
        .where(*conditions)
        .order_by(Receipt.received_at.desc(), Receipt.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    items = [ReceiptListItem.model_validate(row, from_attributes=True) for row in rows]
    return ReceiptPage(items=items, total=total)


def cancel_receipt(db: Session, receipt_id: int, reason: str, user_id: int) -> ReceiptOut:
    receipt = db.execute(
        select(Receipt)
        .where(Receipt.id == receipt_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if receipt is None:
        raise ReceiptNotFoundError()
    if receipt.status == "cancelled":
        raise ReceiptAlreadyCancelledError()

    lines = db.execute(
        select(ReceiptLine).where(ReceiptLine.receipt_id == receipt.id).order_by(ReceiptLine.id)
    ).scalars()
    try:
        post_movements(
            db,
            [
                MovementIn(
                    line.product_id,
                    -line.qty,
                    "receipt_cancel",
                    doc_type=DOC_TYPE,
                    doc_id=receipt.id,
                    note=reason,
                )
                for line in lines
            ],
            user_id,
        )
    except InsufficientStockError as exc:
        raise ReceiptCancelError(
            f"Нельзя отменить приход: товара на остатке меньше, чем было в приходе. {exc.message}"
        ) from exc

    receipt.status = "cancelled"
    receipt.cancelled_at = func.now()
    receipt.cancelled_by = user_id
    receipt.cancel_reason = reason
    db.commit()
    return get_receipt(db, receipt.id)
