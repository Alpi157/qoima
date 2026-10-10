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
from app.returns.models import SaleReturn, SaleReturnLine
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
    """Signed line facts, dated by the sale or return that produced them."""
    known = SaleLine.unit_cost.is_not(None)
    revenue = cast(SaleLine.line_total, Numeric)
    cost = cast(SaleLine.qty, Numeric) * SaleLine.unit_cost
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
        )
        .join(SaleReturn, SaleReturn.id == SaleReturnLine.return_id)
        .where(
            SaleReturn.status == "posted",
            *local_date_range(SaleReturn.returned_at, date_from, date_to),
        )
    )
    return union_all(sales, returns).subquery()


def summary(db: Session, date_from: date, date_to: date) -> SummaryOut:
    validate_period(date_from, date_to)
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
    )
    line_fields = {"revenue", "cost", "profit", "revenue_unknown_cost", "defect_loss"}
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
    facts = union_all(lines, sales, payments, returns).subquery()
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
