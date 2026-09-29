from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.customers import service
from app.customers.models import Customer
from app.customers.schemas import CustomerCreate, CustomerOut, CustomerPage, CustomerUpdate
from app.db import get_db
from app.schema_types import DbId

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("", response_model=CustomerPage)
def search_customers(
    q: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> CustomerPage:
    return service.search_customers(db, q, limit, offset)


# Declared before /{customer_id}, which would otherwise take "recent" for an id.
@router.get("/recent", response_model=list[CustomerOut])
def recent_customers(
    limit: int = Query(6, ge=1, le=20), db: Session = Depends(get_db)
) -> list[Customer]:
    return service.recent_customers(db, limit)


@router.get("/{customer_id}", response_model=CustomerOut)
def get_customer(customer_id: DbId, db: Session = Depends(get_db)) -> Customer:
    return service.get_customer(db, customer_id)


@router.post("", response_model=CustomerOut, status_code=status.HTTP_201_CREATED)
def create_customer(payload: CustomerCreate, db: Session = Depends(get_db)) -> Customer:
    return service.create_customer(db, payload)


@router.patch("/{customer_id}", response_model=CustomerOut)
def update_customer(
    customer_id: DbId, payload: CustomerUpdate, db: Session = Depends(get_db)
) -> Customer:
    return service.update_customer(db, customer_id, payload)
