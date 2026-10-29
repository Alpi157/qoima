from datetime import date, timedelta

from fastapi.exceptions import RequestValidationError
from sqlalchemy import Date, Numeric, case, cast, func, literal, select, union_all
from sqlalchemy.orm import Session

from app.auth.models import User
from app.buy_today.service import evaluate_products
from app.catalog.models import Product
from app.customers.models import Customer
from app.db_utils import LOCAL_TZ, local_date_range
from app.expenses.models import Expense
from app.expenses.schemas import EXPENSE_CATEGORIES
from app.inventory.models import StockMovement
from app.inventory.service import round_half_up
from app.payments.models import CustomerPayment
from app.rates.service import SessionFactory
from app.reports.schemas import (
    AdjustmentDirection,
    AdjustmentReportItem,
    AdjustmentReportPage,
    CustomerReportItem,
    CustomerReportPage,
    DayOut,
    ExpenseCategoryTotal,
    ProductReportItem,
    ProductReportPage,
    ReceivedOut,
    SummaryOut,
)
from app.returns.models import SaleReturn, SaleReturnLine
from app.sales.models import Sale, SaleLine
from app.settings.service import get_business_settings, percent_from_bp


def validate_period(date_from: date, date_to: date) -> None:
    error = None
    if date_to < date_from:
        error = ("report_period_order", "Дата окончания не может быть раньше даты начала")
    elif (date_to - date_from).days >= 366:
        error = ("report_period_too_long", "Период отчёта не может превышать 366 дней")
    if error:
        raise RequestValidationError(
            [
                {
                    "type": error[0],
                    "loc": ("query", "to"),
                    "msg": error[1],
                    "input": date_to.isoformat(),
                }
            ]
        )


def _local_date(column):
    return cast(func.timezone(LOCAL_TZ, column), Date)


def _sales_source(date_from: date, date_to: date):
    """Signed line facts, dated by the sale or return that produced them."""
    known = SaleLine.unit_cost.is_not(None)
    revenue = cast(SaleLine.line_total, Numeric)
    cost = cast(SaleLine.qty, Numeric) * SaleLine.unit_cost
    discount = case(
        (
            SaleLine.list_price.is_not(None),
            func.greatest(cast(SaleLine.list_price, Numeric) - SaleLine.unit_price, 0),
        ),
        else_=0,
    )
    sales = (
        select(
            Sale.id.label("sale_id"),
            Sale.customer_id,
            SaleLine.product_id,
            _local_date(Sale.sold_at).label("date"),
            SaleLine.qty,
            revenue.label("revenue"),
            case((known, cost), else_=0).label("cost"),
            case((known, revenue - cost), else_=0).label("profit"),
            case((known, 0), else_=revenue).label("revenue_unknown_cost"),
            literal(True).label("is_sale"),
            literal(0).label("defect_loss"),
            (discount * SaleLine.qty).label("discount_total"),
            case((SaleLine.list_price.is_(None), 1), else_=0).label("discount_unknown_count"),
        )
        .join(Sale, Sale.id == SaleLine.sale_id)
        .where(Sale.status == "posted", *local_date_range(Sale.sold_at, date_from, date_to))
    )
    known_return = SaleReturnLine.unit_cost.is_not(None)
    good = SaleReturnLine.condition == "good"
    return_revenue = cast(SaleReturnLine.line_total, Numeric)
    return_cost = cast(SaleReturnLine.qty, Numeric) * SaleReturnLine.unit_cost
    returns = (
        select(
            SaleReturn.sale_id,
            SaleReturn.customer_id,
            SaleReturnLine.product_id,
            _local_date(SaleReturn.returned_at),
            -SaleReturnLine.qty,
            -return_revenue,
            case((known_return & good, -return_cost), else_=0),
            case((known_return, -return_revenue + case((good, return_cost), else_=0)), else_=0),
            case((known_return, 0), else_=-return_revenue),
            literal(False),
            case((known_return & ~good, return_cost), else_=0),
            -discount * SaleReturnLine.qty,
            literal(0),
        )
        .join(SaleReturn, SaleReturn.id == SaleReturnLine.return_id)
        .join(SaleLine, SaleLine.id == SaleReturnLine.sale_line_id)
        .where(
            SaleReturn.status == "posted",
            *local_date_range(SaleReturn.returned_at, date_from, date_to),
        )
    )
    return union_all(sales, returns).subquery()


def _buy_today_totals(
    db: Session, date_from: date, date_to: date, session_factory: SessionFactory | None
) -> tuple[int, int, int]:
    sales = (
        select(SaleLine.product_id, SaleLine.qty, SaleLine.unit_cost)
        .join(Sale, Sale.id == SaleLine.sale_id)
        .where(Sale.status == "posted", *local_date_range(Sale.sold_at, date_from, date_to))
    )
    returns = (
        select(SaleReturnLine.product_id, -SaleReturnLine.qty, SaleReturnLine.unit_cost)
        .join(SaleReturn, SaleReturn.id == SaleReturnLine.return_id)
        .where(
            SaleReturn.status == "posted",
            SaleReturnLine.condition == "good",
            *local_date_range(SaleReturn.returned_at, date_from, date_to),
        )
    )
    source = union_all(sales, returns).subquery()
    known = source.c.unit_cost.is_not(None)
    rows = db.execute(
        select(
            source.c.product_id,
            func.coalesce(func.sum(source.c.qty).filter(known), 0),
            func.coalesce(func.sum(cast(source.c.qty, Numeric) * source.c.unit_cost), 0),
            func.count(),
            func.count().filter(known),
        ).group_by(source.c.product_id)
    ).all()
    if not rows:
        return 0, 0, 0
    products, _, _ = evaluate_products(
        db, [row[0] for row in rows], session_factory=session_factory
    )
    value = base = unknown = 0
    for pid, qty, snapshot_cost, count, known_count in rows:
        replacement = products[pid].buy_today
        if replacement is None:
            unknown += count
        else:
            value += int(qty) * replacement
            base += int(snapshot_cost)
            unknown += count - known_count
    return value, base, unknown


def _expense_totals(db: Session, date_from: date, date_to: date) -> list[ExpenseCategoryTotal]:
    rows = db.execute(
        select(Expense.category, func.sum(Expense.amount), func.count())
        .where(
            Expense.status == "posted",
            Expense.expense_date >= date_from,
            Expense.expense_date <= date_to,
        )
        .group_by(Expense.category)
    ).all()
    values = {category: (amount, count) for category, amount, count in rows}
    return [
        ExpenseCategoryTotal(
            category=category, amount=int(values[category][0]), count=values[category][1]
        )
        for category in EXPENSE_CATEGORIES
        if category in values and values[category][0]
    ]


def adjustment_conditions(date_from: date, date_to: date, opening: date | None):
    conditions = [
        StockMovement.kind == "adjustment",
        *local_date_range(StockMovement.created_at, date_from, date_to),
    ]
    if opening is not None:
        conditions.extend(
            local_date_range(StockMovement.created_at, opening + timedelta(days=1), None)
        )
    return conditions


def summary(
    db: Session, date_from: date, date_to: date, *, session_factory: SessionFactory | None = None
) -> SummaryOut:
    validate_period(date_from, date_to)
    settings = get_business_settings(db, read_only=True)
    source = _sales_source(date_from, date_to)
    fields = (
        "revenue",
        "sales_count",
        "cost",
        "profit",
        "revenue_unknown_cost",
        "debt_given",
        "cash",
        "card",
        "returns_total",
        "returns_count",
        "defect_loss",
        "discount_total",
        "discount_unknown_count",
        "write_off_value",
        "write_off_count",
        "surplus_value",
        "adjustment_unknown_count",
    )
    line_fields = {
        "revenue",
        "cost",
        "profit",
        "revenue_unknown_cost",
        "defect_loss",
        "discount_total",
        "discount_unknown_count",
    }
    lines = select(
        source.c.date,
        *(
            (func.sum(source.c[field]) if field in line_fields else literal(0)).label(field)
            for field in fields
        ),
    ).group_by(source.c.date)

    def document_facts(model, moment, **values):
        return select(
            _local_date(moment).label("date"),
            *(values.get(field, literal(0)).label(field) for field in fields),
        ).where(model.status == "posted", *local_date_range(moment, date_from, date_to))

    sales = document_facts(
        Sale,
        Sale.sold_at,
        sales_count=literal(1),
        debt_given=Sale.total - Sale.paid_at_sale,
        cash=case((Sale.payment_method == "cash", Sale.paid_at_sale), else_=0),
        card=case((Sale.payment_method == "card", Sale.paid_at_sale), else_=0),
    )
    payments = document_facts(
        CustomerPayment,
        CustomerPayment.paid_at,
        cash=case((CustomerPayment.payment_method == "cash", CustomerPayment.amount), else_=0),
        card=case((CustomerPayment.payment_method == "card", CustomerPayment.amount), else_=0),
    )
    returns = document_facts(
        SaleReturn,
        SaleReturn.returned_at,
        returns_total=SaleReturn.total,
        returns_count=literal(1),
        cash=case((SaleReturn.refund_method == "cash", -SaleReturn.refund_amount), else_=0),
        card=case((SaleReturn.refund_method == "card", -SaleReturn.refund_amount), else_=0),
    )
    known = StockMovement.unit_cost.is_not(None)
    minus = StockMovement.qty < 0
    plus = StockMovement.qty > 0
    value = cast(StockMovement.qty, Numeric) * StockMovement.unit_cost
    adjustment_values = {
        "write_off_value": case((minus & known, -value), else_=0),
        "write_off_count": case((minus & known, 1), else_=0),
        "surplus_value": case((plus & known, value), else_=0),
        "adjustment_unknown_count": case((~known, 1), else_=0),
    }
    adjustment_facts = select(
        _local_date(StockMovement.created_at).label("date"),
        *(adjustment_values.get(field, literal(0)).label(field) for field in fields),
    ).where(
        *adjustment_conditions(date_from, date_to, settings.opening_balance_date),
    )
    facts = union_all(lines, sales, payments, returns, adjustment_facts).subquery()
    rows = (
        db.execute(
            select(facts.c.date, *(func.sum(facts.c[field]).label(field) for field in fields))
            .group_by(facts.c.date)
            .order_by(facts.c.date)
        )
        .mappings()
        .all()
    )
    totals = {field: sum(int(row[field]) for row in rows) for field in fields}
    by_day = {row["date"]: row for row in rows}
    days = []
    for index in range((date_to - date_from).days + 1):
        day = date_from + timedelta(days=index)
        row = by_day.get(day)
        days.append(
            DayOut(
                date=day,
                revenue=int(row["revenue"]) if row else 0,
                profit=int(row["profit"]) if row else 0,
            )
        )
    buy_today_cost, buy_today_base_cost, buy_today_unknown_count = _buy_today_totals(
        db, date_from, date_to, session_factory
    )
    categories = _expense_totals(db, date_from, date_to)
    expenses_total = sum(item.amount for item in categories)
    settings = get_business_settings(db, read_only=True)
    card_commission = round_half_up(max(totals["card"], 0) * settings.card_commission_bp, 10000)
    tax_estimate = round_half_up(max(totals["revenue"], 0) * settings.tax_bp, 10000)
    operating_total = expenses_total + card_commission + tax_estimate
    return SummaryOut(
        expenses_total=expenses_total,
        expenses_count=sum(item.count for item in categories),
        expenses_by_category=categories,
        card_commission=card_commission,
        tax_estimate=tax_estimate,
        card_commission_percent=percent_from_bp(settings.card_commission_bp),
        tax_percent=percent_from_bp(settings.tax_bp),
        operating_total=operating_total,
        profit_after_expenses=totals["profit"]
        - totals["write_off_value"]
        + totals["surplus_value"]
        - operating_total,
        buy_today_base_cost=buy_today_base_cost,
        rate_effect=buy_today_cost - buy_today_base_cost,
        buy_today_cost=buy_today_cost,
        buy_today_unknown_count=buy_today_unknown_count,
        **{field: totals[field] for field in fields if field not in ("cash", "card")},
        received=ReceivedOut(
            cash=totals["cash"], card=totals["card"], total=totals["cash"] + totals["card"]
        ),
        days=days,
    )


def products(
    db: Session, date_from: date, date_to: date, limit: int, offset: int
) -> ProductReportPage:
    validate_period(date_from, date_to)
    source = _sales_source(date_from, date_to)
    grouped = (
        select(
            source.c.product_id,
            func.sum(source.c.qty).label("qty"),
            *(
                func.sum(source.c[field]).label(field)
                for field in ("revenue", "cost", "profit", "revenue_unknown_cost")
            ),
        )
        .group_by(source.c.product_id)
        .subquery()
    )
    total = db.scalar(select(func.count()).select_from(grouped))
    rows = db.execute(
        select(grouped, Product.article, Product.name, Product.unit)
        .join(Product, Product.id == grouped.c.product_id)
        .order_by(grouped.c.revenue.desc(), grouped.c.product_id)
        .limit(limit)
        .offset(offset)
    ).all()
    return ProductReportPage(
        items=[ProductReportItem.model_validate(row, from_attributes=True) for row in rows],
        total=total,
    )


def customers(
    db: Session, date_from: date, date_to: date, limit: int, offset: int
) -> CustomerReportPage:
    validate_period(date_from, date_to)
    source = _sales_source(date_from, date_to)
    grouped = (
        select(
            source.c.customer_id,
            func.count(source.c.sale_id.distinct()).filter(source.c.is_sale).label("sales_count"),
            func.sum(source.c.revenue).label("revenue"),
            func.sum(source.c.profit).label("profit"),
            func.sum(source.c.revenue_unknown_cost).label("revenue_unknown_cost"),
        )
        .group_by(source.c.customer_id)
        .subquery()
    )
    total = db.scalar(select(func.count()).select_from(grouped))
    rows = db.execute(
        select(grouped, Customer.name)
        .outerjoin(Customer, Customer.id == grouped.c.customer_id)
        .order_by(grouped.c.revenue.desc(), grouped.c.customer_id.asc().nulls_last())
        .limit(limit)
        .offset(offset)
    ).all()
    return CustomerReportPage(
        items=[CustomerReportItem.model_validate(row, from_attributes=True) for row in rows],
        total=total,
    )


def adjustments(
    db: Session,
    date_from: date,
    date_to: date,
    direction: AdjustmentDirection,
    limit: int,
    offset: int,
) -> AdjustmentReportPage:
    validate_period(date_from, date_to)
    settings = get_business_settings(db, read_only=True)
    conditions = (
        *adjustment_conditions(date_from, date_to, settings.opening_balance_date),
        StockMovement.qty < 0 if direction == "minus" else StockMovement.qty > 0,
        *local_date_range(StockMovement.created_at, date_from, date_to),
    )
    total = db.scalar(select(func.count()).select_from(StockMovement).where(*conditions))
    rows = db.execute(
        select(
            StockMovement.id.label("movement_id"),
            StockMovement.created_at,
            StockMovement.product_id,
            Product.article,
            Product.name,
            Product.unit,
            StockMovement.qty,
            StockMovement.unit_cost,
            (func.abs(cast(StockMovement.qty, Numeric)) * StockMovement.unit_cost).label("value"),
            StockMovement.note.label("reason"),
            User.full_name.label("created_by_name"),
        )
        .join(Product, Product.id == StockMovement.product_id)
        .join(User, User.id == StockMovement.created_by)
        .where(*conditions)
        .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return AdjustmentReportPage(
        items=[AdjustmentReportItem.model_validate(row, from_attributes=True) for row in rows],
        total=total,
    )
