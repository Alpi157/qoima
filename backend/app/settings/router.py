from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.settings import service
from app.settings.models import BusinessSettings
from app.settings.schemas import BusinessSettingsOut, BusinessSettingsUpdate

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=BusinessSettingsOut)
def get_settings(db: Session = Depends(get_db)) -> BusinessSettings:
    return service.get_business_settings(db)


@router.put("", response_model=BusinessSettingsOut)
def update_settings(
    payload: BusinessSettingsUpdate, db: Session = Depends(get_db)
) -> BusinessSettings:
    return service.update_business_settings(db, payload)
