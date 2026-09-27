from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.orm import Session

from app.customers.models import Customer
from app.customers.schemas import CustomerCreate, CustomerPage, CustomerUpdate
from app.db_utils import LIKE_ESCAPE, contains_pattern
from app.errors import CustomerNotFoundError


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


def search_customers(db: Session, q: str | None, limit: int, offset: int) -> CustomerPage:
    conditions: list[ColumnElement[bool]] = []
    if q is not None and q.strip():
        pattern = contains_pattern(q.strip().lower())
        conditions.append(
            or_(
                func.lower(Customer.name).like(pattern, escape=LIKE_ESCAPE),
                Customer.phone.like(pattern, escape=LIKE_ESCAPE),
            )
        )

    total = db.execute(select(func.count()).select_from(Customer).where(*conditions)).scalar_one()
    customers = db.execute(
        select(Customer)
        .where(*conditions)
        .order_by(Customer.name, Customer.id)
        .limit(limit)
        .offset(offset)
    ).scalars()
    return CustomerPage.model_validate({"items": list(customers), "total": total})
