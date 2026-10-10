import re

from sqlalchemy import (
    BigInteger,
    ColumnElement,
    Text,
    case,
    cast,
    func,
    literal,
    or_,
    select,
    union_all,
)
from sqlalchemy.orm import Session

from app.customers.models import Customer
from app.customers.schemas import (
    CustomerCreate,
    CustomerDebtsPage,
    CustomerOut,
    CustomerPage,
    CustomerUpdate,
    LedgerItem,
    LedgerPage,
)
from app.db_utils import LIKE_ESCAPE, contains_pattern
from app.errors import CustomerNotFoundError
from app.payments.models import CustomerPayment
from app.sales.models import Sale


def debt_source():
    """One grouped SQL source for current debt, shared by single and list queries."""
    sales = (
        select(
            Sale.customer_id.label("customer_id"),
            cast(func.sum(Sale.total - Sale.paid_at_sale), BigInteger).label("amount"),
        )
        .where(Sale.status == "posted", Sale.customer_id.is_not(None))
        .group_by(Sale.customer_id)
    )
    payments = (
        select(
            CustomerPayment.customer_id.label("customer_id"),
            cast(-func.sum(CustomerPayment.amount), BigInteger).label("amount"),
        )
        .where(CustomerPayment.status == "posted")
        .group_by(CustomerPayment.customer_id)
    )
    changes = union_all(sales, payments).subquery()
    return (
        select(changes.c.customer_id, cast(func.sum(changes.c.amount), BigInteger).label("debt"))
        .group_by(changes.c.customer_id)
        .subquery()
    )


def current_debt(db: Session, customer_id: int) -> int:
    source = debt_source()
    return db.scalar(
        select(func.coalesce(source.c.debt, 0))
        .select_from(Customer)
        .outerjoin(source, source.c.customer_id == Customer.id)
        .where(Customer.id == customer_id)
    )


def _out(customer: Customer, debt: int) -> CustomerOut:
    return CustomerOut.model_validate(
        {
            "id": customer.id,
            "name": customer.name,
            "phone": customer.phone,
            "note": customer.note,
            "created_at": customer.created_at,
            "debt": debt,
        }
    )


def get_customer(db: Session, customer_id: int) -> CustomerOut:
    source = debt_source()
    row = db.execute(
        select(Customer, func.coalesce(source.c.debt, 0))
        .outerjoin(source, source.c.customer_id == Customer.id)
        .where(Customer.id == customer_id)
    ).one_or_none()
    if row is None:
        raise CustomerNotFoundError()
    return _out(*row)


def create_customer(db: Session, data: CustomerCreate) -> CustomerOut:
    customer = Customer(**data.model_dump())
    db.add(customer)
    db.commit()
    return get_customer(db, customer.id)


def update_customer(db: Session, customer_id: int, data: CustomerUpdate) -> CustomerOut:
    customer = db.get(Customer, customer_id)
    if customer is None:
        raise CustomerNotFoundError()
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(customer, field, value)
    db.commit()
    return get_customer(db, customer.id)


# Mobile number with the country prefix: 7XXXXXXXXXX or 8XXXXXXXXXX.
FULL_PHONE_DIGITS = 11
FULL_PHONE_PATTERN = "^[78][0-9]{10}$"


def _phone_digits_match(q: str) -> ColumnElement[bool] | None:
    """Match the digits of the query against the digits of the stored phone.

    A full number drops its leading 7/8 on both sides, so that 8701..., +7 701... and 701...
    find the same customer.
    """
    digits = re.sub(r"[^0-9]", "", q)
    if not digits:
        return None
    phone_digits = func.regexp_replace(Customer.phone, "[^0-9]", "", "g", type_=Text)
    if len(digits) == FULL_PHONE_DIGITS and digits[0] in "78":
        digits = digits[1:]
        phone_digits = case(
            (phone_digits.regexp_match(FULL_PHONE_PATTERN), func.substr(phone_digits, 2)),
            else_=phone_digits,
        )
    # digits holds only 0-9, so it needs no LIKE escaping.
    return phone_digits.contains(digits)


def search_customers(db: Session, q: str | None, limit: int, offset: int) -> CustomerPage:
    conditions: list[ColumnElement[bool]] = []
    if q is not None and q.strip():
        pattern = contains_pattern(q.strip().lower())
        matches = [
            func.lower(Customer.name).like(pattern, escape=LIKE_ESCAPE),
            Customer.phone.like(pattern, escape=LIKE_ESCAPE),
        ]
        digits_match = _phone_digits_match(q)
        if digits_match is not None:
            matches.append(digits_match)
        conditions.append(or_(*matches))

    total = db.execute(select(func.count()).select_from(Customer).where(*conditions)).scalar_one()
    source = debt_source()
    customers = db.execute(
        select(Customer, func.coalesce(source.c.debt, 0))
        .outerjoin(source, source.c.customer_id == Customer.id)
        .where(*conditions)
        .order_by(Customer.name, Customer.id)
        .limit(limit)
        .offset(offset)
    ).all()
    return CustomerPage(items=[_out(*row) for row in customers], total=total)


def recent_customers(db: Session, limit: int) -> list[CustomerOut]:
    """Customers by their last posted sale; if there are fewer than limit, the newest customers
    without posted sales follow."""
    last_sale = (
        select(Sale.customer_id, func.max(Sale.sold_at).label("last_sold_at"))
        .where(Sale.status == "posted", Sale.customer_id.is_not(None))
        .group_by(Sale.customer_id)
        .subquery()
    )
    customers = list(
        db.execute(
            select(Customer)
            .join(last_sale, last_sale.c.customer_id == Customer.id)
            .order_by(last_sale.c.last_sold_at.desc(), Customer.id.desc())
            .limit(limit)
        ).scalars()
    )
    if len(customers) < limit:
        customers += db.execute(
            select(Customer)
            .where(Customer.id.not_in(select(last_sale.c.customer_id)))
            .order_by(Customer.created_at.desc(), Customer.id.desc())
            .limit(limit - len(customers))
        ).scalars()
    if not customers:
        return []
    source = debt_source()
    rows = db.execute(
        select(Customer, func.coalesce(source.c.debt, 0))
        .outerjoin(source, source.c.customer_id == Customer.id)
        .where(Customer.id.in_([customer.id for customer in customers]))
    ).all()
    by_id = {customer.id: _out(customer, debt) for customer, debt in rows}
    return [by_id[customer.id] for customer in customers]


def list_debts(db: Session, limit: int, offset: int) -> CustomerDebtsPage:
    source = debt_source()
    rows = db.execute(
        select(Customer, source.c.debt)
        .join(source, source.c.customer_id == Customer.id)
        .where(source.c.debt != 0)
        .order_by(
            case((source.c.debt > 0, 0), else_=1),
            case((source.c.debt > 0, -source.c.debt), else_=source.c.debt),
            Customer.id,
        )
    ).all()
    return CustomerDebtsPage(
        items=[_out(*row) for row in rows[offset : offset + limit]],
        total=len(rows),
        total_debt=sum(debt for _, debt in rows if debt > 0),
        debtors_count=sum(debt > 0 for _, debt in rows),
    )


def customer_ledger(db: Session, customer_id: int, limit: int, offset: int) -> LedgerPage:
    if db.get(Customer, customer_id) is None:
        raise CustomerNotFoundError()
    entries = union_all(
        select(
            literal("sale").label("kind"),
            Sale.id,
            Sale.number,
            Sale.sold_at.label("occurred_at"),
            Sale.created_at,
            Sale.total.label("amount"),
            Sale.paid_at_sale,
            Sale.payment_method,
            (Sale.total - Sale.paid_at_sale).label("debt_change"),
        ).where(Sale.customer_id == customer_id, Sale.status == "posted"),
        select(
            literal("payment").label("kind"),
            CustomerPayment.id,
            CustomerPayment.number,
            CustomerPayment.paid_at.label("occurred_at"),
            CustomerPayment.created_at,
            CustomerPayment.amount.label("amount"),
            literal(None, type_=BigInteger).label("paid_at_sale"),
            CustomerPayment.payment_method,
            (-CustomerPayment.amount).label("debt_change"),
        ).where(CustomerPayment.customer_id == customer_id, CustomerPayment.status == "posted"),
    ).subquery()
    history = select(
        entries.c.kind,
        entries.c.id,
        entries.c.number,
        entries.c.occurred_at,
        entries.c.created_at,
        entries.c.amount,
        entries.c.paid_at_sale,
        entries.c.payment_method,
        entries.c.debt_change,
        cast(
            func.sum(entries.c.debt_change).over(
                order_by=(
                    entries.c.occurred_at,
                    entries.c.created_at,
                    entries.c.kind,
                    entries.c.id,
                )
            ),
            BigInteger,
        ).label("debt_after"),
    ).subquery()
    total = db.scalar(select(func.count()).select_from(history))
    rows = db.execute(
        select(history)
        .order_by(
            history.c.occurred_at.desc(),
            history.c.created_at.desc(),
            history.c.kind.desc(),
            history.c.id.desc(),
        )
        .limit(limit)
        .offset(offset)
    ).all()
    return LedgerPage(
        items=[LedgerItem.model_validate(row, from_attributes=True) for row in rows], total=total
    )
