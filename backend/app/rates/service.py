import logging
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, DecimalException, Inexact, localcontext
from http.client import HTTPException
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db_utils import LOCAL_TZ
from app.errors import RateDateInFutureError, RateNotFoundError
from app.rates.models import ExchangeRate
from app.rates.schemas import CURRENCIES, Currency, RateOut

SessionFactory = Callable[[], Session]
MAX_RESPONSE_BYTES = 1024 * 1024
RETRY_SECONDS = 600
logger = logging.getLogger("uvicorn.error.rates")
_failures: dict[date, float] = {}
_failure_lock = threading.Lock()
_clock = time.monotonic


def today_local() -> date:
    return datetime.now(ZoneInfo(LOCAL_TZ)).date()


@dataclass(frozen=True)
class FeedRates:
    rates: dict[Currency, Decimal]
    published_date: date | None
    problems: tuple[str, ...]


def _unit_rate(item: ET.Element) -> Decimal:
    quant = int(item.findtext("quant", ""))
    amount = Decimal(item.findtext("description", ""))
    if quant <= 0 or not amount.is_finite() or amount <= 0:
        raise ValueError("non-positive rate or quant")
    # Inexact rejects division/quantization that would silently round the feed.
    with localcontext() as context:
        context.prec = 50
        context.traps[Inexact] = True
        rate = (amount / Decimal(quant)).quantize(Decimal("0.0001"))
    if not 0 < rate <= Decimal("99999999.9999"):
        raise ValueError("rate outside NUMERIC(12,4)")
    return rate


def parse_rates(body: bytes) -> FeedRates:
    root = ET.fromstring(body)
    if root.tag != "rates":
        raise ValueError("expected rates root")
    published = root.findtext("date")
    published_date = datetime.strptime(published.strip(), "%d.%m.%Y").date() if published else None
    rates: dict[Currency, Decimal] = {}
    problems = []
    for currency in CURRENCIES:
        items = [item for item in root.findall("item") if item.findtext("title") == currency]
        try:
            if len(items) != 1:
                raise ValueError("missing or duplicate currency")
            rates[currency] = _unit_rate(items[0])
        except (ValueError, DecimalException) as exc:
            problems.append(f"{currency}: {type(exc).__name__}: {exc}")
    return FeedRates(rates, published_date, tuple(problems))


def _fetch_rates(requested_date: date) -> FeedRates:
    url = urlsplit(get_settings().nbk_rates_url)
    query = [(key, value) for key, value in parse_qsl(url.query) if key != "fdate"]
    query.append(("fdate", requested_date.strftime("%d.%m.%Y")))
    address = urlunsplit(url._replace(query=urlencode(query)))
    with urllib.request.urlopen(address, timeout=5) as response:
        if response.status != 200:
            raise ValueError(f"HTTP status {response.status}")
        body = response.read(MAX_RESPONSE_BYTES + 1)
    if len(body) > MAX_RESPONSE_BYTES:
        raise ValueError("response exceeds 1 MiB")
    return parse_rates(body)


def _stored_rate(
    session_factory: SessionFactory, currency: Currency, requested_date: date, *, exact: bool
) -> RateOut | None:
    with session_factory() as db:
        day_condition = (
            ExchangeRate.rate_date == requested_date
            if exact
            else ExchangeRate.rate_date <= requested_date
        )
        row = db.scalar(
            select(ExchangeRate)
            .where(ExchangeRate.currency == currency, day_condition)
            .order_by(ExchangeRate.rate_date.desc())
            .limit(1)
        )
        if row is None:
            return None
        return RateOut(
            currency=currency,
            requested_date=requested_date,
            rate_date=row.rate_date,
            rate=row.rate,
            exact=row.rate_date == requested_date,
        )


def get_rate(
    currency: Currency,
    requested_date: date,
    *,
    session_factory: SessionFactory,
    before_fetch: Callable[[], None] | None = None,
) -> RateOut:
    """Resolve a rate outside the caller's document transaction.

    The supplied factory owns every short-lived session, including concurrent requests.
    Never pass a live document session: fetching must precede its locks.
    """
    if requested_date > today_local():
        raise RateDateInFutureError()
    stored = _stored_rate(session_factory, currency, requested_date, exact=True)
    if stored is not None:
        return stored

    with _failure_lock:
        now = _clock()
        for day, deadline in list(_failures.items()):
            if deadline <= now:
                del _failures[day]
        suppressed = requested_date in _failures

    if not suppressed:
        feed = None
        problem = None
        try:
            if before_fetch is not None:
                before_fetch()
            feed = _fetch_rates(requested_date)
            if feed.problems:
                problem = "; ".join(feed.problems)
        except (
            OSError,
            HTTPException,
            ValueError,
            LookupError,
            DecimalException,
            ET.ParseError,
        ) as exc:
            problem = f"{type(exc).__name__}: {exc}"
        if problem is not None:
            with _failure_lock:
                _failures[requested_date] = _clock() + RETRY_SECONDS
            logger.warning("NBK %s: %s", requested_date, " ".join(problem.split())[:300])
        else:
            logger.info("NBK %s: fetched CNY, USD", requested_date)
        if feed is not None and feed.rates:
            with session_factory() as db:
                db.execute(
                    insert(ExchangeRate)
                    .values(
                        [
                            {
                                "rate_date": requested_date,
                                "currency": code,
                                "rate": value,
                                "source": "nbk",
                                "published_date": feed.published_date,
                            }
                            for code, value in feed.rates.items()
                        ]
                    )
                    .on_conflict_do_nothing(index_elements=["rate_date", "currency"])
                )
                db.commit()

    result = _stored_rate(session_factory, currency, requested_date, exact=False)
    if result is None:
        raise RateNotFoundError()
    return result
