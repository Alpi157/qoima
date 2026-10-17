from collections import Counter
from datetime import UTC, date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi.exceptions import RequestValidationError
from psycopg.errors import UniqueViolation
from sqlalchemy import BigInteger, ColumnElement, cast, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.auth.models import User
from app.catalog.service import load_line_products
from app.db_utils import LOCAL_TZ, RECEIPT_REQUEST_LOCK, local_date_range, lock_request_id
from app.errors import (
    InsufficientStockError,
    NbkRateMismatchError,
    ReceiptAlreadyCancelledError,
    ReceiptCancelError,
    ReceiptNotFoundError,
    ReceiptRequestConflictError,
)
from app.inventory.service import MovementIn, post_movements
from app.numbering import next_number
from app.rates.models import ExchangeRate
from app.receipts.costing import CostExpense, CostLine, calculate_receipt_costs
from app.receipts.models import Receipt, ReceiptExpense, ReceiptExpenseAllocation, ReceiptLine
from app.receipts.schemas import (
    AllocationOut,
    ExpenseOut,
    RateInput,
    ReceiptCreate,
    ReceiptLineOut,
    ReceiptListItem,
    ReceiptOut,
    ReceiptPage,
    ReceiptStatus,
)
from app.settings.service import get_business_settings

DOC_TYPE = "receipt"
REQUEST_ID_CONSTRAINT = "uq_receipts_request_id"


def _rate_signature(currency, rate, source, rate_date) -> tuple:
    return currency, rate, source, rate_date if source == "nbk" else None


def _expense_signature(expense, rate, targets) -> tuple:
    return (
        expense.kind,
        expense.amount_minor,
        *_rate_signature(expense.currency, rate, expense.rate_source, expense.rate_date),
        expense.allocation_method,
        tuple(sorted(targets)),
    )


def _existing_receipt(db: Session, data: ReceiptCreate) -> ReceiptOut | None:
    receipt = db.scalar(select(Receipt).where(Receipt.request_id == data.request_id))
    if receipt is None:
        return None
    stored = get_receipt(db, receipt.id)
    requested_expenses = Counter(
        _expense_signature(
            expense,
            expense.rate_decimal,
            expense.product_ids or []
            if expense.allocation_method == "selected"
            else [(part.product_id, part.amount_tiyn) for part in expense.manual or []]
            if expense.allocation_method == "manual"
            else [],
        )
        for expense in data.expenses
    )
    stored_expenses = Counter(
        _expense_signature(
            expense,
            expense.exchange_rate,
            [part.product_id for part in expense.allocations]
            if expense.allocation_method == "selected"
            else [(part.product_id, part.amount_tiyn) for part in expense.allocations]
            if expense.allocation_method == "manual"
            else [],
        )
        for expense in stored.expenses
    )
    same_time = data.received_at is None or receipt.received_at.astimezone(
        UTC
    ) == data.received_at.astimezone(UTC)
    if (
        Counter((line.product_id, line.qty, line.unit_price_minor) for line in stored.lines)
        != Counter((line.product_id, line.qty, line.price_minor) for line in data.lines)
        or requested_expenses != stored_expenses
        or _rate_signature(
            receipt.currency, receipt.exchange_rate, receipt.rate_source, receipt.rate_date
        )
        != _rate_signature(data.currency, data.rate_decimal, data.rate_source, data.rate_date)
        or receipt.supplier != data.supplier
        or receipt.note != data.note
        or not same_time
    ):
        raise ReceiptRequestConflictError(params={"id": receipt.id, "number": receipt.number})
    return stored


def _is_request_id_conflict(exc: IntegrityError) -> bool:
    return (
        isinstance(exc.orig, UniqueViolation)
        and exc.orig.diag.constraint_name == REQUEST_ID_CONSTRAINT
    )


def _currency_snapshot(db: Session, data: RateInput, local_date: date, path: tuple) -> dict:
    rate_date = None
    if data.currency != "KZT":
        rate_date = local_date if data.rate_source == "manual" else data.rate_date
        if data.rate_source == "nbk":
            if rate_date > local_date:
                raise RequestValidationError(
                    [
                        {
                            "type": "rate_date_after_receipt",
                            "loc": ("body", *path, "rate_date"),
                            "msg": "Дата курса не может быть позже местной даты прихода",
                            "input": rate_date.isoformat(),
                        }
                    ]
                )
            rate = db.scalar(
                select(ExchangeRate.rate).where(
                    ExchangeRate.rate_date == rate_date,
                    ExchangeRate.currency == data.currency,
                )
            )
            if rate is None or rate != data.rate_decimal:
                raise NbkRateMismatchError(
                    params={
                        "currency": data.currency,
                        "rate_date": rate_date.isoformat(),
                    }
                )
    return {
        "currency": data.currency,
        "exchange_rate": data.rate_decimal,
        "rate_date": rate_date,
        "rate_source": data.rate_source,
    }


def _post_receipt(db: Session, data: ReceiptCreate, user_id: int) -> Receipt:
    """Post a receipt without committing. The caller owns the transaction."""
    products = load_line_products(db, [line.product_id for line in data.lines], "receipt")
    vat_payer = get_business_settings(db).is_vat_payer
    received_at = data.received_at or datetime.now(UTC)
    local_date = received_at.astimezone(ZoneInfo(LOCAL_TZ)).date()
    currency_snapshot = _currency_snapshot(db, data, local_date, ())
    expense_snapshots = [
        _currency_snapshot(db, expense, local_date, ("expenses", index))
        for index, expense in enumerate(data.expenses)
    ]
    costs = calculate_receipt_costs(
        [CostLine(line.product_id, line.qty, line.price_minor) for line in data.lines],
        data.rate_scaled,
        data.currency,
        [
            CostExpense(
                kind=expense.kind,
                amount_minor=expense.amount_minor,
                currency=expense.currency,
                rate_scaled=expense.rate_scaled,
                allocation_method=expense.allocation_method,
                product_ids=tuple(expense.product_ids or []),
                manual=tuple((part.product_id, part.amount_tiyn) for part in expense.manual or []),
            )
            for expense in data.expenses
        ],
        vat_payer,
    )
    receipt = Receipt(
        number=next_number(db, DOC_TYPE),
        request_id=data.request_id,
        supplier=data.supplier,
        note=data.note,
        created_by=user_id,
        received_at=received_at,
        vat_payer_snapshot=vat_payer,
        **currency_snapshot,
    )
    db.add(receipt)
    db.flush()
    lines = {}
    for line in data.lines:
        product = products[line.product_id]
        cost = costs.lines[line.product_id]
        lines[line.product_id] = ReceiptLine(
            receipt_id=receipt.id,
            product_id=line.product_id,
            article=product.article,
            name=product.name,
            unit=product.unit,
            qty=line.qty,
            unit_price_minor=line.price_minor,
            goods_total=cost.goods_total,
            expenses_total=cost.expenses_total,
            unit_cost=cost.unit_cost,
        )
    db.add_all(lines.values())
    expenses = [
        ReceiptExpense(
            receipt_id=receipt.id,
            kind=expense.kind,
            amount_minor=expense.amount_minor,
            allocation_method=expense.allocation_method,
            amount_tiyn=cost.amount_tiyn,
            is_vat_credit=cost.is_vat_credit,
            revaluation_currency=cost.revaluation_currency,
            revaluation_rate=(
                Decimal(cost.revaluation_rate_scaled) / 10_000
                if cost.revaluation_rate_scaled is not None
                else None
            ),
            **snapshot,
        )
        for expense, cost, snapshot in zip(
            data.expenses, costs.expenses, expense_snapshots, strict=True
        )
    ]
    db.add_all(expenses)
    db.flush()
    db.add_all(
        ReceiptExpenseAllocation(
            expense_id=expense.id,
            receipt_line_id=lines[pid].id,
            amount_tiyn=amount,
        )
        for expense, cost in zip(expenses, costs.expenses, strict=True)
        for pid, amount in sorted(cost.allocations.items())
    )
    post_movements(
        db,
        [
            MovementIn(
                line.product_id,
                line.qty,
                "receipt",
                doc_type=DOC_TYPE,
                doc_id=receipt.id,
                unit_cost=costs.lines[line.product_id].unit_cost,
            )
            for line in data.lines
        ],
        user_id,
    )
    return receipt


def post_receipt(db: Session, data: ReceiptCreate, user_id: int) -> tuple[ReceiptOut, bool]:
    lock_request_id(db, RECEIPT_REQUEST_LOCK, data.request_id)
    existing = _existing_receipt(db, data)
    if existing is not None:
        return existing, False
    try:
        receipt = _post_receipt(db, data, user_id)
        db.commit()
    except IntegrityError as exc:
        if not _is_request_id_conflict(exc):
            raise
        db.rollback()
        existing = _existing_receipt(db, data)
        if existing is None:
            raise
        return existing, False
    return get_receipt(db, receipt.id), True


# The user who cancelled a document; a second alias of users next to the author.
Canceller = aliased(User)


def get_receipt(db: Session, receipt_id: int) -> ReceiptOut:
    row = db.execute(
        select(Receipt, User.full_name, Canceller.full_name)
        .join(User, User.id == Receipt.created_by)
        .outerjoin(Canceller, Canceller.id == Receipt.cancelled_by)
        .where(Receipt.id == receipt_id)
        .execution_options(populate_existing=True)
    ).one_or_none()
    if row is None:
        raise ReceiptNotFoundError()
    receipt, created_by_name, cancelled_by_name = row
    stored_lines = db.scalars(
        select(ReceiptLine).where(ReceiptLine.receipt_id == receipt.id).order_by(ReceiptLine.id)
    ).all()
    stored_expenses = db.scalars(
        select(ReceiptExpense)
        .where(ReceiptExpense.receipt_id == receipt.id)
        .order_by(ReceiptExpense.id)
    ).all()
    allocations = {expense.id: [] for expense in stored_expenses}
    credit_expenses = {expense.id for expense in stored_expenses if expense.is_vat_credit}
    credit_by_line = dict.fromkeys((line.id for line in stored_lines), 0)
    for allocation, pid in db.execute(
        select(ReceiptExpenseAllocation, ReceiptLine.product_id)
        .join(ReceiptLine, ReceiptLine.id == ReceiptExpenseAllocation.receipt_line_id)
        .where(ReceiptLine.receipt_id == receipt.id)
        .order_by(ReceiptExpenseAllocation.expense_id, ReceiptLine.product_id)
    ):
        allocations[allocation.expense_id].append(
            AllocationOut(
                receipt_line_id=allocation.receipt_line_id,
                product_id=pid,
                amount_tiyn=allocation.amount_tiyn,
            )
        )
        if allocation.expense_id in credit_expenses:
            credit_by_line[allocation.receipt_line_id] += allocation.amount_tiyn
    expenses = [
        ExpenseOut.model_validate(
            {
                **{
                    column.key: getattr(expense, column.key)
                    for column in ReceiptExpense.__table__.columns
                },
                "allocations": allocations[expense.id],
            }
        )
        for expense in stored_expenses
    ]
    lines = [
        ReceiptLineOut(
            product_id=line.product_id,
            article=line.article,
            name=line.name,
            unit=line.unit,
            qty=line.qty,
            unit_cost=line.unit_cost,
            unit_price_minor=line.unit_price_minor,
            goods_total=line.goods_total,
            expenses_total=line.expenses_total,
            vat_credit_total=credit_by_line[line.id],
        )
        for line in stored_lines
    ]
    known_goods = [line.goods_total for line in lines if line.goods_total is not None]
    goods_total = sum(known_goods) if known_goods else None
    expenses_total = sum(line.expenses_total for line in lines)
    return ReceiptOut(
        id=receipt.id,
        number=receipt.number,
        request_id=receipt.request_id,
        received_at=receipt.received_at,
        supplier=receipt.supplier,
        note=receipt.note,
        currency=receipt.currency,
        exchange_rate=receipt.exchange_rate,
        rate_date=receipt.rate_date,
        rate_source=receipt.rate_source,
        vat_payer_snapshot=receipt.vat_payer_snapshot,
        status=receipt.status,
        cancelled_at=receipt.cancelled_at,
        cancel_reason=receipt.cancel_reason,
        cancelled_by_name=cancelled_by_name,
        created_by_name=created_by_name,
        created_at=receipt.created_at,
        lines=lines,
        expenses=expenses,
        total_qty=sum(line.qty for line in lines),
        goods_total=goods_total,
        expenses_total=expenses_total,
        vat_credit_total=sum(credit_by_line.values()),
        total_cost=sum(
            line.goods_total + line.expenses_total for line in lines if line.goods_total is not None
        )
        if known_goods
        else None,
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
            cast(func.sum(ReceiptLine.goods_total + ReceiptLine.expenses_total), BigInteger).label(
                "total_cost"
            ),
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
            Receipt.currency,
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
                    unit_cost=line.unit_cost,
                )
                for line in lines
            ],
            user_id,
        )
    except InsufficientStockError as exc:
        raise ReceiptCancelError(
            f"Нельзя отменить приход: товара на остатке меньше, чем было в приходе. {exc.message}",
            exc.params,
        ) from exc

    receipt.status = "cancelled"
    receipt.cancelled_at = func.now()
    receipt.cancelled_by = user_id
    receipt.cancel_reason = reason
    db.commit()
    return get_receipt(db, receipt.id)
