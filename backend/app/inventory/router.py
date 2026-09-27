from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.auth.dependencies import current_user
from app.auth.models import User
from app.db import get_db
from app.inventory import service
from app.inventory.schemas import AdjustmentCreate, AdjustmentOut, MovementPage
from app.schema_types import DbId

router = APIRouter(tags=["stock"])


@router.post(
    "/stock/adjustments", response_model=AdjustmentOut, status_code=status.HTTP_201_CREATED
)
def create_adjustment(
    payload: AdjustmentCreate,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> AdjustmentOut:
    return service.create_adjustment(db, payload, user.id)


@router.get("/products/{product_id}/movements", response_model=MovementPage)
def list_movements(
    product_id: DbId,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> MovementPage:
    return service.list_movements(db, product_id, limit, offset)
