import re

from sqlalchemy import ColumnElement, Text, case, func, or_, select
from sqlalchemy.orm import Session

from app.customers.models import Customer
from app.customers.schemas import CustomerCreate, CustomerPage, CustomerUpdate
from app.db_utils import LIKE_ESCAPE, contains_pattern
from app.errors import CustomerNotFoundError
from app.sales.models import Sale


def get_customer(db: Session, customer_id: int) -> Customer:
    customer = db.get(Customer, customer_id)
    if customer is None:
        raise CustomerNotFoundError()
    return customer


def create_customer(db: Session, data: CustomerCreate) -> Customer:
    customer = Customer(**data.model_dump())
    db.add(customer)
    db.commit()
    return customer


def update_customer(db: Session, customer_id: int, data: CustomerUpdate) -> Customer:
    customer = get_customer(db, customer_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(customer, field, value)
    db.commit()
    return customer


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
    customers = db.execute(
        select(Customer)
        .where(*conditions)
        .order_by(Customer.name, Customer.id)
        .limit(limit)
        .offset(offset)
    ).scalars()
    return CustomerPage.model_validate({"items": list(customers), "total": total})


def recent_customers(db: Session, limit: int) -> list[Customer]:
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
    return customers
