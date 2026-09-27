from sqlalchemy import func
from sqlalchemy.orm import Session

from app.settings.models import SETTINGS_ID, BusinessSettings
from app.settings.schemas import BusinessSettingsUpdate


def _settings_row(db: Session) -> BusinessSettings:
    """The single settings row. The migration creates it; recreate it if it was deleted."""
    settings = db.get(BusinessSettings, SETTINGS_ID)
    if settings is None:
        settings = BusinessSettings(id=SETTINGS_ID)
        db.add(settings)
        db.flush()
        db.refresh(settings)
    return settings


def get_business_settings(db: Session) -> BusinessSettings:
    return _settings_row(db)


def update_business_settings(db: Session, data: BusinessSettingsUpdate) -> BusinessSettings:
    settings = _settings_row(db)
    for field, value in data.model_dump().items():
        setattr(settings, field, value)
    settings.updated_at = func.now()
    db.commit()
    db.refresh(settings)
    return settings
