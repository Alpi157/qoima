from sqlalchemy import func
from sqlalchemy.orm import Session

from app.settings.models import SETTINGS_ID, BusinessSettings
from app.settings.schemas import BusinessSettingsOut, BusinessSettingsUpdate


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
        else BusinessSettings(
            id=SETTINGS_ID,
            is_vat_payer=False,
            rate_warning_percent=10,
            card_commission_bp=0,
            tax_bp=0,
        )
    )


def update_business_settings(db: Session, data: BusinessSettingsUpdate) -> BusinessSettings:
    settings = _settings_row(db)
    for field, value in data.model_dump(exclude_unset=True).items():
        if field in ("card_commission_percent", "tax_percent"):
            whole, _, fraction = value.partition(".")
            setattr(
                settings,
                "card_commission_bp" if field == "card_commission_percent" else "tax_bp",
                int(whole) * 100 + int(fraction.ljust(2, "0")),
            )
        else:
            setattr(settings, field, value)
    settings.updated_at = func.now()
    db.commit()
    db.refresh(settings)
    return settings


def percent_from_bp(bp: int) -> str:
    return f"{bp // 100}.{bp % 100:02d}".rstrip("0").rstrip(".")


def settings_out(settings: BusinessSettings) -> BusinessSettingsOut:
    return BusinessSettingsOut(
        **{
            name: getattr(settings, name)
            for name in BusinessSettingsOut.model_fields
            if name not in ("card_commission_percent", "tax_percent")
        },
        card_commission_percent=percent_from_bp(settings.card_commission_bp),
        tax_percent=percent_from_bp(settings.tax_bp),
    )
