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


def get_business_settings(db: Session, *, read_only: bool = False) -> BusinessSettings:
    if not read_only:
        return _settings_row(db)
    settings = db.get(BusinessSettings, SETTINGS_ID)
    # A preview must not recreate a missing singleton row.
    return (
        settings
        if settings is not None
        else BusinessSettings(id=SETTINGS_ID, is_vat_payer=False, rate_warning_percent=10)
    )


def update_business_settings(db: Session, data: BusinessSettingsUpdate) -> BusinessSettings:
    settings = _settings_row(db)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(settings, field, value)
    settings.updated_at = func.now()
    db.commit()
    db.refresh(settings)
    return settings
