from fastapi.exceptions import RequestValidationError
from sqlalchemy import Date, cast, func, select
from sqlalchemy.orm import Session

from app.db_utils import LOCAL_TZ
from app.rates import service as rates_service
from app.sales.models import Sale
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
            attention_markup_drop_points=10,
            attention_debt_days=30,
            attention_frozen_days=90,
            attention_runway_days=30,
            attention_discount_percent=10,
            attention_loss_percent=2,
        )
    )


def update_business_settings(db: Session, data: BusinessSettingsUpdate) -> BusinessSettings:
    opening = data.opening_balance_date
    if opening is not None:
        error = None
        params = {}
        if opening > rates_service.today_local():
            error = ("opening_date_in_future", "Дата начала учёта не может быть в будущем")
        else:
            first = db.scalar(
                select(func.min(cast(func.timezone(LOCAL_TZ, Sale.sold_at), Date))).where(
                    Sale.status == "posted"
                )
            )
            if first is not None and first <= opening:
                error = (
                    "opening_date_after_sales",
                    "Дата начала учёта должна быть раньше первой продажи",
                )
                params = {"first_sale_date": first.isoformat()}
        if error:
            raise RequestValidationError(
                [
                    {
                        "type": error[0],
                        "loc": ("body", "opening_balance_date"),
                        "msg": error[1],
                        "input": opening.isoformat(),
                        "ctx": params,
                    }
                ]
            )
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
