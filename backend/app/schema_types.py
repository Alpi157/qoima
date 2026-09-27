from datetime import UTC, datetime, timedelta
from typing import Annotated

from pydantic import BeforeValidator, Field, StringConstraints

# Trimmed, non-empty string: use as Annotated[str, NonEmpty, MaxLen(n)].
NonEmpty = StringConstraints(strip_whitespace=True, min_length=1)


MAX_BIGINT = 2**63 - 1
# Id of a database row, in a path, a query or a request body. Not strict: path and query
# values arrive as strings. The upper bound turns an oversized id into 422 instead of a DB error.
DbId = Annotated[int, Field(ge=1, le=MAX_BIGINT)]
# Why a document was cancelled or a stock level adjusted.
Reason = Annotated[str, NonEmpty, Field(min_length=3, max_length=500)]


def _blank_to_none(value: object) -> object:
    if isinstance(value, str) and not value.strip():
        return None
    return value


# Blank string becomes None: use as Annotated[Annotated[str, Trimmed, ...] | None, BlankToNone].
BlankToNone = BeforeValidator(_blank_to_none)
Trimmed = StringConstraints(strip_whitespace=True)


def reject_explicit_nulls(data: object, fields: tuple[str, ...]) -> object:
    """For PATCH bodies: a field may be omitted, but must not be sent as null."""
    if isinstance(data, dict):
        nulls = [f for f in fields if f in data and data[f] is None]
        if nulls:
            raise ValueError(f"Поле не может быть пустым: {', '.join(nulls)}")
    return data


# Limits shared by document lines (receipts, sales).
MAX_LINES = 200
MAX_QTY = 100_000
Qty = Annotated[int, Field(strict=True, ge=1, le=MAX_QTY)]
Note = Annotated[Annotated[str, Trimmed, Field(max_length=1000)] | None, BlankToNone]

# Tolerated difference between the client's and the server's clocks.
CLOCK_SKEW = timedelta(minutes=1)


def check_not_in_future(value: datetime | None, message: str) -> datetime | None:
    """For document dates: raise ValueError(message) if the value is in the future."""
    if value is not None and value > datetime.now(UTC) + CLOCK_SKEW:
        raise ValueError(message)
    return value
