from datetime import date, datetime, time, timedelta

from sqlalchemy import ColumnElement, DateTime, func, literal

LIKE_ESCAPE = "\\"


def escape_like(value: str) -> str:
    """Escape LIKE wildcards so the value is matched literally (use with ESCAPE LIKE_ESCAPE)."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def contains_pattern(value: str) -> str:
    return f"%{escape_like(value)}%"


# Business time zone: calendar days in filters are days in this zone.
LOCAL_TZ = "Asia/Almaty"


def local_day_start(day: date) -> ColumnElement[datetime]:
    """Start of the given calendar day in LOCAL_TZ, as timestamptz (PostgreSQL does the offset)."""
    return func.timezone(LOCAL_TZ, literal(datetime.combine(day, time()), DateTime()))


def local_date_range(
    column: ColumnElement[datetime], date_from: date | None, date_to: date | None
) -> list[ColumnElement[bool]]:
    """Conditions for column within [date_from, date_to] in LOCAL_TZ, date_to inclusive."""
    conditions: list[ColumnElement[bool]] = []
    if date_from is not None:
        conditions.append(column >= local_day_start(date_from))
    if date_to is not None and date_to < date.max:
        conditions.append(column < local_day_start(date_to + timedelta(days=1)))
    return conditions
