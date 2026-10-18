from collections import Counter
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from fastapi.exceptions import RequestValidationError
from psycopg.errors import UniqueViolation
from sqlalchemy import BigInteger, ColumnElement, cast, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.auth.models import User
from app.catalog.models import Product
from app.catalog.service import LastPurchase, load_last_purchases, load_line_products
from app.db_utils import LOCAL_TZ, RECEIPT_REQUEST_LOCK, local_date_range, lock_request_id
from app.errors import (
    AppError,
    InsufficientStockError,
    NbkRateMismatchError,
    ReceiptAlreadyCancelledError,
    ReceiptCancelError,
    ReceiptNotFoundError,
    ReceiptRequestConflictError,
    ReceiptWarningsError,
)
from app.inventory.service import MovementIn, post_movements, round_half_up
from app.numbering import next_number
from app.rates.models import ExchangeRate
from app.rates.schemas import RateOut
from app.rates.service import SessionFactory, get_rate
from app.receipts.costing import CostExpense, CostLine, ReceiptCost, calculate_receipt_costs
from app.receipts.models import Receipt, ReceiptExpense, ReceiptExpenseAllocation, ReceiptLine
from app.receipts.schemas import (
    AllocationOut,
    CostJumpParams,
    CostJumpWarning,
    CostNotBelowPriceParams,
    CostNotBelowPriceWarning,
    ExpenseOut,
    PreviewAllocationOut,
    RateDeviationParams,
    RateDeviationWarning,
    RateInput,
    ReceiptCreate,
    ReceiptDefaultsOut,
    ReceiptInput,
    ReceiptLineOut,
    ReceiptListItem,
    ReceiptOut,
    ReceiptPage,
    ReceiptPreviewExpenseOut,
    ReceiptPreviewIn,
    ReceiptPreviewLineOut,
    ReceiptPreviewOut,
    ReceiptStatus,
    ReceiptWarning,
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


@dataclass(frozen=True)
class PreparedReceipt:
    moment: datetime
    products: dict[int, Product]
    currency_snapshot: dict
    expense_snapshots: list[dict]
    vat_payer: bool
    costs: ReceiptCost
    previous: dict[int, LastPurchase]
    warnings: list[ReceiptWarning]


def _nbk_comparisons(
    data: ReceiptInput, local_date: date, session_factory: SessionFactory | None
) -> dict[str, RateOut | None]:
    comparisons = {}
    for rate_input in (data, *data.expenses):
        if rate_input.rate_source != "manual" or rate_input.currency in comparisons:
            continue
        if session_factory is None:
            raise RuntimeError("Manual receipt rates require a separate session factory")
        try:
            comparisons[rate_input.currency] = get_rate(
                rate_input.currency, local_date, session_factory=session_factory
            )
        except AppError:
            comparisons[rate_input.currency] = None
    return comparisons


def _rate_warnings(
    data: ReceiptInput, comparisons: dict[str, RateOut | None], threshold: int
) -> list[ReceiptWarning]:
    warnings = []
    for index, rate_input in [(None, data), *enumerate(data.expenses)]:
        nbk = comparisons.get(rate_input.currency)
        if rate_input.rate_source != "manual" or nbk is None:
            continue
        delta = abs(rate_input.rate_decimal - nbk.rate) * 100
        if delta <= threshold * nbk.rate:
            continue
        target = "receipt" if index is None else "expense"
        rate = format(rate_input.rate_decimal, ".4f")
        nbk_rate = format(nbk.rate, ".4f")
        warnings.append(
            RateDeviationWarning(
                key=f"rate_deviation:{target}:{index if index is not None else '-'}:"
                f"{rate_input.currency}:{rate}:{nbk_rate}",
                params=RateDeviationParams(
                    target=target,
                    index=index,
                    currency=rate_input.currency,
                    rate=rate,
                    nbk_rate=nbk_rate,
                    nbk_rate_date=nbk.rate_date,
                    nbk_exact=nbk.exact,
                    percent=int((delta / nbk.rate).quantize(Decimal(1), rounding=ROUND_HALF_UP)),
                ),
            )
        )
    return warnings


def _prepare_receipt(
    db: Session, data: ReceiptInput, moment: datetime, nbk_compare: dict[str, RateOut | None]
) -> PreparedReceipt:
    """Read and calculate only: no writes, locks, numbers or transaction completion."""
    products = load_line_products(db, [line.product_id for line in data.lines], "receipt")
    settings = get_business_settings(db, read_only=True)
    vat_payer = settings.is_vat_payer
    local_date = moment.astimezone(ZoneInfo(LOCAL_TZ)).date()
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
    previous = load_last_purchases(db, [line.product_id for line in data.lines])
    warnings = _rate_warnings(data, nbk_compare, settings.rate_warning_percent)
    for line in data.lines:
        pid = line.product_id
        product = products[pid]
        unit_cost = costs.lines[pid].unit_cost
        prev = previous.get(pid)
        if (
            prev is not None
            and prev.unit_cost > 0
            and (unit_cost >= 2 * prev.unit_cost or 2 * unit_cost <= prev.unit_cost)
        ):
            warnings.append(
                CostJumpWarning(
                    key=f"cost_jump:{pid}:{unit_cost}:{prev.unit_cost}",
                    params=CostJumpParams(
                        product_id=pid,
                        article=product.article,
                        unit_cost=unit_cost,
                        previous_cost=prev.unit_cost,
                        previous_received_at=prev.received_at,
                    ),
                )
            )
        if unit_cost >= product.sale_price:
            warnings.append(
                CostNotBelowPriceWarning(
                    key=f"cost_not_below_price:{pid}:{unit_cost}:{product.sale_price}",
                    params=CostNotBelowPriceParams(
                        product_id=pid,
                        article=product.article,
                        unit_cost=unit_cost,
                        sale_price=product.sale_price,
                    ),
                )
            )
    return PreparedReceipt(
        moment, products, currency_snapshot, expense_snapshots, vat_payer, costs, previous, warnings
    )


def _post_receipt(
    db: Session, data: ReceiptCreate, user_id: int, prepared: PreparedReceipt
) -> Receipt:
    """Write a prepared receipt without committing; also used by the atomic XLSX import."""
    products, costs = prepared.products, prepared.costs
    receipt = Receipt(
        number=next_number(db, DOC_TYPE),
        request_id=data.request_id,
        supplier=data.supplier,
        note=data.note,
        created_by=user_id,
        received_at=prepared.moment,
        vat_payer_snapshot=prepared.vat_payer,
        **prepared.currency_snapshot,
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
            data.expenses, costs.expenses, prepared.expense_snapshots, strict=True
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


def post_receipt(
    db: Session,
    data: ReceiptCreate,
    user_id: int,
    *,
    session_factory: SessionFactory | None = None,
) -> tuple[ReceiptOut, bool]:
    moment = data.received_at or datetime.now(UTC)
    existing = _existing_receipt(db, data)
    if existing is not None:
        return existing, False
    nbk_compare = _nbk_comparisons(
        data, moment.astimezone(ZoneInfo(LOCAL_TZ)).date(), session_factory
    )
    lock_request_id(db, RECEIPT_REQUEST_LOCK, data.request_id)
    existing = _existing_receipt(db, data)
    if existing is not None:
        return existing, False
    try:
        prepared = _prepare_receipt(db, data, moment, nbk_compare)
        if data.confirmed_warnings is not None:
            confirmed = set(data.confirmed_warnings)
            if any(warning.key not in confirmed for warning in prepared.warnings):
                raise ReceiptWarningsError(
                    params={"warnings": [w.model_dump(mode="json") for w in prepared.warnings]}
                )
        receipt = _post_receipt(db, data, user_id, prepared)
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


def _markup_percent(sale_price: int, unit_cost: int) -> int | None:
    if unit_cost == 0:
        return None
    difference = sale_price - unit_cost
    return (1 if difference >= 0 else -1) * round_half_up(abs(difference) * 100, unit_cost)


def preview_receipt(
    db: Session, data: ReceiptPreviewIn, *, session_factory: SessionFactory
) -> ReceiptPreviewOut:
    moment = data.received_at or datetime.now(UTC)
    comparisons = _nbk_comparisons(
        data, moment.astimezone(ZoneInfo(LOCAL_TZ)).date(), session_factory
    )
    prepared = _prepare_receipt(db, data, moment, comparisons)
    costs = prepared.costs
    lines = []
    for line in data.lines:
        pid = line.product_id
        product = prepared.products[pid]
        cost = costs.lines[pid]
        previous = prepared.previous.get(pid)
        lines.append(
            ReceiptPreviewLineOut(
                product_id=pid,
                article=product.article,
                name=product.name,
                unit=product.unit,
                qty=line.qty,
                unit_price_minor=line.price_minor,
                goods_total=cost.goods_total,
                expenses_total=cost.expenses_total,
                vat_credit_total=cost.vat_credit_total,
                unit_cost=cost.unit_cost,
                sale_price=product.sale_price,
                previous_cost=previous.unit_cost if previous is not None else None,
                markup_percent=_markup_percent(product.sale_price, cost.unit_cost),
            )
        )
    expenses = [
        ReceiptPreviewExpenseOut(
            index=index,
            kind=expense.kind,
            amount_tiyn=cost.amount_tiyn,
            is_vat_credit=cost.is_vat_credit,
            revaluation_currency=cost.revaluation_currency,
            revaluation_rate=(
                Decimal(cost.revaluation_rate_scaled) / 10_000
                if cost.revaluation_rate_scaled is not None
                else None
            ),
            allocations=[
                PreviewAllocationOut(product_id=pid, amount_tiyn=amount)
                for pid, amount in sorted(cost.allocations.items())
            ],
        )
        for index, (expense, cost) in enumerate(zip(data.expenses, costs.expenses, strict=True))
    ]
    return ReceiptPreviewOut(
        **prepared.currency_snapshot,
        vat_payer=prepared.vat_payer,
        lines=lines,
        expenses=expenses,
        goods_total=costs.goods_total,
        expenses_total=costs.expenses_total,
        vat_credit_total=costs.vat_credit_total,
        total_cost=costs.goods_total + costs.expenses_total,
        warnings=prepared.warnings,
    )


def receipt_defaults(db: Session, supplier: str | None) -> ReceiptDefaultsOut:
    query = (
        select(Receipt.currency)
        .where(Receipt.status == "posted")
        .order_by(Receipt.received_at.desc(), Receipt.id.desc())
        .limit(1)
    )
    if supplier and supplier.strip():
        currency = db.scalar(
            query.where(func.lower(func.btrim(Receipt.supplier)) == supplier.strip().lower())
        )
        if currency is not None:
            return ReceiptDefaultsOut(currency=currency, source="supplier")
    currency = db.scalar(query)
    return ReceiptDefaultsOut(
        currency=currency or "KZT", source="last" if currency is not None else "default"
    )


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
