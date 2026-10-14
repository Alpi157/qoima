from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.auth.dependencies import current_user
from app.auth.models import User
from app.db import get_db
from app.inventory import service
from app.inventory.schemas import AdjustmentCreate, AdjustmentOut, MovementPage, StockSummary
from app.schema_types import DbId

router = APIRouter(tags=["stock"])


@router.get("/stock/summary", response_model=StockSummary)
def stock_summary(db: Session = Depends(get_db)) -> StockSummary:
    return service.stock_summary(db)


@router.post(
    "/stock/adjustments",
    response_model=AdjustmentOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        200: {
            "model": AdjustmentOut,
            "description": "Корректировка с этим request_id уже проведена",
        }
    },
)
def create_adjustment(
    payload: AdjustmentCreate,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> AdjustmentOut:
    adjustment, created = service.create_adjustment(db, payload, user.id)
    if not created:
        response.status_code = status.HTTP_200_OK
    return adjustment


@router.get("/products/{product_id}/movements", response_model=MovementPage)
def list_movements(
    product_id: DbId,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> MovementPage:
    return service.list_movements(db, product_id, limit, offset)
