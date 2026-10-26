from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.buy_today.schemas import (
    ActiveQuoteOut,
    BuyTodayOut,
    StockBuyTodayGroup,
    StockBuyTodayOut,
    StockBuyTodayValues,
    TodayRateOut,
)
from app.catalog.models import Product
from app.db_utils import LOCAL_TZ
from app.errors import AppError, ProductNotFoundError
from app.inventory.models import MAIN_WAREHOUSE_CODE, StockBalance, Warehouse
from app.inventory.service import round_half_up
from app.price_quotes.models import ProductPriceQuote
from app.rates import service as rates_service
from app.rates.service import SessionFactory
from app.receipts.models import Receipt, ReceiptExpense, ReceiptExpenseAllocation, ReceiptLine
from app.receipts.replacement import (
    ReplacementExpense,
    calculate_replacement,
    markup_percent,
    price_for_markup,
    rounded,
)


@dataclass(frozen=True)
class PurchaseBasis:
    line: ReceiptLine
    receipt: Receipt


def _basis_kind(purchase: PurchaseBasis | None, quote: ProductPriceQuote | None) -> str | None:
    if quote is not None:
        if purchase is None:
            return "quote"
        purchase_day = purchase.receipt.received_at.astimezone(ZoneInfo(LOCAL_TZ)).date()
        if quote.quoted_on > purchase_day or (
            quote.quoted_on == purchase_day and quote.created_at > purchase.receipt.created_at
        ):
            return "quote"
    return "purchase" if purchase is not None else None


def _load_bases(db: Session, ids: Sequence[int]):
    ranked = (
        select(
            ReceiptLine.id.label("line_id"),
            func.row_number()
            .over(
                partition_by=ReceiptLine.product_id,
                order_by=(Receipt.received_at.desc(), ReceiptLine.id.desc()),
            )
            .label("rank"),
        )
        .join(Receipt, Receipt.id == ReceiptLine.receipt_id)
        .where(
            ReceiptLine.product_id.in_(ids),
            Receipt.status == "posted",
            ReceiptLine.unit_cost.is_not(None),
        )
        .subquery()
    )
    purchases = {
        line.product_id: PurchaseBasis(line, receipt)
        for line, receipt in db.execute(
            select(ReceiptLine, Receipt)
            .join(ranked, ranked.c.line_id == ReceiptLine.id)
            .join(Receipt, Receipt.id == ReceiptLine.receipt_id)
            .where(ranked.c.rank == 1)
        )
    }
    quote_rank = (
        select(
            ProductPriceQuote.id.label("quote_id"),
            func.row_number()
            .over(
                partition_by=ProductPriceQuote.product_id,
                order_by=(
                    ProductPriceQuote.quoted_on.desc(),
                    ProductPriceQuote.created_at.desc(),
                    ProductPriceQuote.id.desc(),
                ),
            )
            .label("rank"),
        )
        .where(ProductPriceQuote.product_id.in_(ids), ProductPriceQuote.status == "posted")
        .subquery()
    )
    quotes = defaultdict(list)
    for quote in db.scalars(
        select(ProductPriceQuote)
        .join(quote_rank, quote_rank.c.quote_id == ProductPriceQuote.id)
        .where(quote_rank.c.rank <= 2)
        .order_by(quote_rank.c.rank)
    ):
        quotes[quote.product_id].append(quote)
    expenses = defaultdict(list)
    line_ids = [basis.line.id for basis in purchases.values()]
    if line_ids:
        for allocation, expense in db.execute(
            select(ReceiptExpenseAllocation, ReceiptExpense)
            .join(ReceiptExpense, ReceiptExpense.id == ReceiptExpenseAllocation.expense_id)
            .where(ReceiptExpenseAllocation.receipt_line_id.in_(line_ids))
        ):
            expenses[allocation.receipt_line_id].append(
                ReplacementExpense(
                    allocation.amount_tiyn,
                    expense.revaluation_currency,
                    int(expense.revaluation_rate * 10_000)
                    if expense.revaluation_rate is not None
                    else None,
                    expense.is_vat_credit,
                )
            )
    return purchases, quotes, expenses


def _required_currencies(currency: str, expenses: Sequence[ReplacementExpense]) -> set[str]:
    return ({currency} - {"KZT"}) | {
        e.revaluation_currency
        for e in expenses
        if not e.is_vat_credit and e.amount_tiyn and e.revaluation_currency is not None
    }


def evaluate_products(
    db: Session, product_ids: Sequence[int] | None, *, session_factory: SessionFactory | None
) -> tuple[dict[int, BuyTodayOut], dict[int, int], list[TodayRateOut]]:
    """Four bounded data queries; one independent rate lookup per required currency."""
    today = rates_service.today_local()
    main_id = select(Warehouse.id).where(Warehouse.code == MAIN_WAREHOUSE_CODE).scalar_subquery()
    query = select(Product, StockBalance.qty, StockBalance.avg_cost).outerjoin(
        StockBalance,
        (StockBalance.product_id == Product.id) & (StockBalance.warehouse_id == main_id),
    )
    query = (
        query.where(StockBalance.qty > 0)
        if product_ids is None
        else query.where(Product.id.in_(product_ids))
    )
    products = db.execute(query).all()
    if not products:
        return {}, {}, []
    ids = [product.id for product, _, _ in products]
    purchases, quotes, expenses = _load_bases(db, ids)
    prepared = {}
    currencies = set()
    for product, qty, avg in products:
        purchase = purchases.get(product.id)
        active = quotes[product.id][0] if quotes[product.id] else None
        kind = _basis_kind(purchase, active)
        costs = expenses[purchase.line.id] if purchase is not None else []
        currency = (
            active.currency if kind == "quote" else purchase.receipt.currency if purchase else None
        )
        required = _required_currencies(currency, costs) if currency is not None else set()
        currencies.update(required)
        prepared[product.id] = (
            product,
            qty,
            avg,
            purchase,
            active,
            kind,
            costs,
            currency,
            required,
        )
    rates = {}
    for currency in sorted(currencies):
        if session_factory is None:
            raise RuntimeError("Replacement rates require an independent session factory")
        try:
            rate = rates_service.get_rate(currency, today, session_factory=session_factory)
            rates[currency] = TodayRateOut(
                currency=currency,
                rate=format(rate.rate, ".4f"),
                rate_date=rate.rate_date,
                exact=rate.exact,
            )
        except AppError:
            rates[currency] = TodayRateOut(currency=currency, rate=None, rate_date=None, exact=None)
    scaled = {
        currency: int(rate.rate.replace(".", ""))
        for currency, rate in rates.items()
        if rate.rate is not None
    }
    result = {}
    quantities = {}
    for pid, (
        product,
        qty,
        avg,
        purchase,
        active,
        kind,
        costs,
        currency,
        required,
    ) in prepared.items():
        quantities[pid] = qty or 0
        cost_then = purchase.line.unit_cost if purchase else None
        markup_then = markup_percent(product.sale_price, cost_then)
        price = (
            active.price_minor
            if kind == "quote"
            else purchase.line.unit_price_minor
            if purchase
            else None
        )
        reason = "no_purchase" if kind is None else "no_rate" if required - scaled.keys() else None
        cost = (
            calculate_replacement(
                purchase.line.qty if purchase else 1, price, currency, costs, scaled
            )
            if reason is None
            else None
        )
        today_rate = (
            TodayRateOut(currency="KZT", rate="1.0000", rate_date=today, exact=True)
            if currency == "KZT"
            else rates.get(currency)
        )
        remaining = quotes[pid][1] if len(quotes[pid]) > 1 else None
        result[pid] = BuyTodayOut(
            basis=kind,
            basis_date=active.quoted_on
            if kind == "quote"
            else purchase.receipt.received_at.astimezone(ZoneInfo(LOCAL_TZ)).date()
            if purchase
            else None,
            basis_receipt_id=purchase.receipt.id if purchase else None,
            currency=currency,
            price_minor=price,
            cost_then=cost_then,
            avg_cost=avg,
            today_rate=today_rate.rate if today_rate else None,
            today_rate_date=today_rate.rate_date if today_rate else None,
            today_rate_exact=today_rate.exact if today_rate else None,
            goods_today=rounded(cost.goods) if cost else None,
            expenses_revalued=rounded(cost.revalued) if cost else None,
            expenses_fixed=rounded(cost.fixed) if cost else None,
            buy_today=cost.unit_cost if cost else None,
            sale_price=product.sale_price,
            markup_then=markup_then,
            markup_now=markup_percent(product.sale_price, cost.unit_cost) if cost else None,
            price_to_keep_markup=price_for_markup(cost.unit_cost, markup_then) if cost else None,
            difference_vs_avg=cost.unit_cost - avg
            if cost is not None and avg is not None
            else None,
            reason_unavailable=reason,
            active_quote=ActiveQuoteOut(
                id=active.id,
                currency=active.currency,
                price_minor=active.price_minor,
                quoted_on=active.quoted_on,
                cancel_fallback_basis=_basis_kind(purchase, remaining),
            )
            if active
            else None,
            expenses_known=purchase is not None,
            rates=[rates[currency] for currency in sorted(required)],
        )
    return result, quantities, list(rates.values())


def product_buy_today(
    db: Session, product_id: int, *, session_factory: SessionFactory
) -> BuyTodayOut:
    products, _, _ = evaluate_products(db, [product_id], session_factory=session_factory)
    if product_id not in products:
        raise ProductNotFoundError()
    return products[product_id]


def _finish_values(values: StockBuyTodayValues) -> None:
    values.difference = values.buy_today_value - values.cost_value
    if values.cost_value:
        tenths = round_half_up(abs(values.difference) * 1000, values.cost_value)
        values.difference_percent = (
            f"{'-' if values.difference < 0 and tenths else ''}{tenths // 10}.{tenths % 10}"
        )


def stock_buy_today(db: Session, *, session_factory: SessionFactory) -> StockBuyTodayOut:
    products, quantities, rates = evaluate_products(db, None, session_factory=session_factory)
    groups = {}
    total = StockBuyTodayValues()
    unknown_count = unknown_cost = 0
    for pid, product in products.items():
        qty = quantities[pid]
        if product.buy_today is None or product.avg_cost is None:
            unknown_count += 1
            if product.avg_cost is not None:
                unknown_cost += qty * product.avg_cost
            continue
        group = groups.setdefault(product.currency, StockBuyTodayGroup(currency=product.currency))
        group.products_count += 1
        group.qty += qty
        group.cost_value += qty * product.avg_cost
        group.buy_today_value += qty * product.buy_today
    for currency in ("KZT", "CNY", "USD"):
        if currency in groups:
            group = groups[currency]
            _finish_values(group)
            total.cost_value += group.cost_value
            total.buy_today_value += group.buy_today_value
    _finish_values(total)
    return StockBuyTodayOut(
        groups=[groups[c] for c in ("KZT", "CNY", "USD") if c in groups],
        total=total,
        rates=rates,
        without_basis_count=unknown_count,
        without_basis_cost_value=unknown_cost,
    )
