from datetime import date, timedelta

from fastapi.exceptions import RequestValidationError
from sqlalchemy import Date, Numeric, case, cast, func, literal, select, union_all
from sqlalchemy.orm import Session

from app.catalog.models import Product
from app.customers.models import Customer
from app.db_utils import LOCAL_TZ, local_date_range
from app.payments.models import CustomerPayment
from app.reports.schemas import (
    CustomerReportItem,
    CustomerReportPage,
    DayOut,
    ProductReportItem,
    ProductReportPage,
    ReceivedOut,
    SummaryOut,
)
from app.sales.models import Sale, SaleLine


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
    """Shared report facts. Step 17.3 adds signed return rows here, before aggregation.

    Return rows must subtract revenue, known cost/profit and unknown-cost revenue
    using the original sale-line snapshot. No return tables exist in step 17.2a.
    """
    known = SaleLine.unit_cost.is_not(None)
    revenue = cast(SaleLine.line_total, Numeric)
    cost = cast(SaleLine.qty, Numeric) * SaleLine.unit_cost
    return (
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
        )
        .join(Sale, Sale.id == SaleLine.sale_id)
        .where(Sale.status == "posted", *local_date_range(Sale.sold_at, date_from, date_to))
        .subquery()
    )


def summary(db: Session, date_from: date, date_to: date) -> SummaryOut:
    validate_period(date_from, date_to)
    source = _sales_source(date_from, date_to)
    lines = (
        select(
            source.c.sale_id,
            func.sum(source.c.revenue).label("revenue"),
            func.sum(source.c.cost).label("cost"),
            func.sum(source.c.profit).label("profit"),
            func.sum(source.c.revenue_unknown_cost).label("revenue_unknown_cost"),
        )
        .group_by(source.c.sale_id)
        .subquery()
    )
    # One row per document: joining its lines cannot multiply its payment or debt.
    sales = select(
        _local_date(Sale.sold_at).label("date"),
        lines.c.revenue,
        literal(1).label("sales_count"),
        lines.c.cost,
        lines.c.profit,
        lines.c.revenue_unknown_cost,
        (Sale.total - Sale.paid_at_sale).label("debt_given"),
        case((Sale.payment_method == "cash", Sale.paid_at_sale), else_=0).label("cash"),
        case((Sale.payment_method == "card", Sale.paid_at_sale), else_=0).label("card"),
    ).join(lines, lines.c.sale_id == Sale.id)
    payments = select(
        _local_date(CustomerPayment.paid_at).label("date"),
        literal(0),
        literal(0),
        literal(0),
        literal(0),
        literal(0),
        literal(0),
        case((CustomerPayment.payment_method == "cash", CustomerPayment.amount), else_=0),
        case((CustomerPayment.payment_method == "card", CustomerPayment.amount), else_=0),
    ).where(
        CustomerPayment.status == "posted",
        *local_date_range(CustomerPayment.paid_at, date_from, date_to),
    )
    facts = union_all(sales, payments).subquery()
    fields = (
        "revenue",
        "sales_count",
        "cost",
        "profit",
        "revenue_unknown_cost",
        "debt_given",
        "cash",
        "card",
    )
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
    return SummaryOut(
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
            func.count(source.c.sale_id.distinct()).label("sales_count"),
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
