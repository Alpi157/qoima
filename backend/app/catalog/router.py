from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.catalog import service
from app.catalog.schemas import ProductCreate, ProductOut, ProductPage, ProductUpdate
from app.db import get_db

router = APIRouter(prefix="/products", tags=["products"])


@router.get("", response_model=ProductPage)
def search_products(
    q: str | None = None,
    include_archived: bool = False,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> ProductPage:
    return service.search_products(db, q, include_archived, limit, offset)


@router.get("/{product_id}", response_model=ProductOut)
def get_product(product_id: int, db: Session = Depends(get_db)) -> ProductOut:
    return service.get_product(db, product_id)


@router.post("", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
def create_product(payload: ProductCreate, db: Session = Depends(get_db)) -> ProductOut:
    return service.create_product(db, payload)


@router.patch("/{product_id}", response_model=ProductOut)
def update_product(
    product_id: int, payload: ProductUpdate, db: Session = Depends(get_db)
) -> ProductOut:
    return service.update_product(db, product_id, payload)
