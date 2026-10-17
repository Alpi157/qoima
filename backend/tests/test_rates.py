import io
import logging
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from threading import Barrier
from types import SimpleNamespace
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from app import cli
from app.errors import RateDateInFutureError, RateNotFoundError
from app.main import app
from app.rates import router, service
from app.rates.models import ExchangeRate
from tests.conftest import test_engine

FIXTURES = Path(__file__).parent / "fixtures" / "nbk"
DAY = date(2026, 10, 16)
REAL_TODAY_LOCAL = service.today_local


class Response(io.BytesIO):
    status = 200


def xml(cny="67.87", usd="454.14", quant="1", published="16.10.2026"):
    items = "".join(
        f"<item><title>{code}</title><description>{value}</description>"
        f"<quant>{quant}</quant></item>"
        for code, value in (("CNY", cny), ("USD", usd))
        if value is not None
    )
    return f"<rates><date>{published}</date>{items}</rates>".encode()


@pytest.fixture(autouse=True)
def local_today(monkeypatch):
    monkeypatch.setattr(service, "today_local", lambda: date(2026, 10, 20))


@pytest.fixture
def rate_factory(isolated_stock_engine, monkeypatch):
    assert isolated_stock_engine.url == test_engine.url
    factory = sessionmaker(bind=isolated_stock_engine, expire_on_commit=False)
    monkeypatch.setattr(router, "SessionLocal", factory)
    monkeypatch.setattr(cli, "SessionLocal", factory)
    return factory


@pytest.fixture
def feed(monkeypatch):
    calls = []

    def open_feed(url, *, timeout):
        assert timeout == 5
        calls.append(url)
        return Response((FIXTURES / "rates-2026-10-16.xml").read_bytes())

    monkeypatch.setattr(urllib.request, "urlopen", open_feed)
    return calls


def seed(factory, day=DAY, currency="CNY", rate="60.1234"):
    with factory() as db:
        db.add(ExchangeRate(rate_date=day, currency=currency, rate=Decimal(rate), source="nbk"))
        db.commit()


@pytest.mark.parametrize(
    "name,published,cny,usd",
    [
        ("rates-2026-10-16.xml", DAY, "67.8700", "454.1400"),
        ("rates-2026-10-18.xml", date(2026, 10, 18), "67.6200", "452.1200"),
    ],
)
def test_parse_real_feed(name, published, cny, usd):
    result = service.parse_rates((FIXTURES / name).read_bytes())
    assert result.published_date == published
    assert result.rates == {"CNY": Decimal(cny), "USD": Decimal(usd)}
    assert not result.problems


def test_quant_is_exact_and_optional_published_date():
    result = service.parse_rates(xml(cny="6787", usd="45414", quant="100", published=""))
    assert result.rates == {"CNY": Decimal("67.8700"), "USD": Decimal("454.1400")}
    assert result.published_date is None


def test_today_uses_almaty_at_utc_day_boundary(monkeypatch):
    class Clock:
        @staticmethod
        def now(tz):
            return datetime(2026, 10, 16, 20, 30, tzinfo=UTC).astimezone(tz)

    monkeypatch.setattr(service, "datetime", Clock)
    assert REAL_TODAY_LOCAL() == date(2026, 10, 17)


@pytest.mark.parametrize(
    "value,quant",
    [
        ("0", "1"),
        ("-1", "1"),
        ("NaN", "1"),
        ("Infinity", "1"),
        ("1.23456", "1"),
        ("1", "3"),
        ("100000000", "1"),
        ("abc", "1"),
        ("1", "0"),
        ("1", "-1"),
        ("1", "1.5"),
    ],
)
def test_bad_currency_does_not_discard_valid_currency(value, quant):
    body = xml(cny=value).replace(b"<quant>1</quant>", f"<quant>{quant}</quant>".encode(), 1)
    result = service.parse_rates(body)
    assert "CNY" not in result.rates
    assert result.rates["USD"] == Decimal("454.1400")
    assert len(result.problems) == 1


def test_save_and_reuse_without_network(rate_factory, feed, monkeypatch):
    monkeypatch.setattr(
        service,
        "get_settings",
        lambda: SimpleNamespace(nbk_rates_url="https://example.test/rates?x=1"),
    )
    result = service.get_rate("CNY", DAY, session_factory=rate_factory)
    assert result.model_dump(mode="json") == {
        "currency": "CNY",
        "requested_date": "2026-10-16",
        "rate_date": "2026-10-16",
        "rate": "67.8700",
        "source": "nbk",
        "exact": True,
    }
    assert len(feed) == 1
    assert parse_qs(urlsplit(feed[0]).query) == {"x": ["1"], "fdate": ["16.10.2026"]}
    assert service.get_rate("CNY", DAY, session_factory=rate_factory) == result
    assert service.get_rate("USD", DAY, session_factory=rate_factory).rate == Decimal("454.1400")
    assert len(feed) == 1
    with rate_factory() as db:
        rows = db.scalars(select(ExchangeRate)).all()
        assert len(rows) == 2
        assert all(row.published_date == DAY and row.fetched_at.tzinfo for row in rows)


def test_requested_date_does_not_follow_published_date(rate_factory, feed):
    sunday = date(2026, 10, 18)
    result = service.get_rate("CNY", sunday, session_factory=rate_factory)
    assert result.rate_date == sunday and result.exact
    with rate_factory() as db:
        assert db.get(ExchangeRate, (sunday, "CNY")).published_date == DAY
    service.get_rate("CNY", sunday, session_factory=rate_factory)
    assert len(feed) == 1


@pytest.mark.parametrize(
    "failure", ["offline", "http", "xml", "missing", "zero", "large", "date", "encoding"]
)
def test_failure_falls_back_and_retries_after_ten_minutes(
    rate_factory, monkeypatch, caplog, failure
):
    seed(rate_factory, DAY - timedelta(days=2), rate="59")
    seed(rate_factory, DAY - timedelta(days=1))
    seed(rate_factory, DAY + timedelta(days=1), rate="99")
    clock = [1000]
    monkeypatch.setattr(service, "_clock", lambda: clock[0])
    calls = []

    def broken(url, *, timeout):
        calls.append(url)
        if failure == "offline":
            raise URLError("offline\nextra line")
        if failure == "http":
            raise HTTPError(url, 503, "Unavailable", {}, None)
        bodies = {
            "xml": b"<rates>",
            "missing": xml(cny=None),
            "zero": xml(cny="0"),
            "large": b"x" * (service.MAX_RESPONSE_BYTES + 1),
            "date": xml(published="bad"),
            "encoding": b'<?xml version="1.0" encoding="no-such-encoding"?><rates/>',
        }
        return Response(bodies[failure])

    monkeypatch.setattr(urllib.request, "urlopen", broken)
    with caplog.at_level(logging.WARNING, logger=service.logger.name):
        result = service.get_rate("CNY", DAY, session_factory=rate_factory)
        assert result.rate == Decimal("60.1234")
        assert result.rate_date == DAY - timedelta(days=1) and not result.exact
        clock[0] += 599
        assert service.get_rate("CNY", DAY, session_factory=rate_factory) == result
        assert len(calls) == 1
        assert len(caplog.records) == 1
        assert "\n" not in caplog.records[0].getMessage()
        clock[0] += 1
        service.get_rate("CNY", DAY, session_factory=rate_factory)
        assert len(calls) == 2


def test_no_rate_and_future_service_errors(rate_factory, monkeypatch):
    with pytest.raises(RateDateInFutureError):
        service.get_rate("CNY", date(2026, 10, 21), session_factory=rate_factory)
    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: Response(xml(cny=None)))
    with pytest.raises(RateNotFoundError):
        service.get_rate("CNY", DAY, session_factory=rate_factory)


def test_service_closes_every_session_before_http(rate_factory, monkeypatch):
    sessions = []

    def factory():
        db = rate_factory()
        sessions.append(db)
        return db

    def download(*args, **kwargs):
        assert sessions and all(not db.in_transaction() for db in sessions)
        return Response(xml())

    monkeypatch.setattr(urllib.request, "urlopen", download)
    service.get_rate("CNY", DAY, session_factory=factory)
    assert all(not db.in_transaction() for db in sessions)


def test_existing_rate_is_not_overwritten_when_other_currency_is_fetched(rate_factory, feed):
    seed(rate_factory, rate="1.2345")
    service.get_rate("USD", DAY, session_factory=rate_factory)
    with rate_factory() as db:
        assert db.get(ExchangeRate, (DAY, "CNY")).rate == Decimal("1.2345")


def test_concurrent_insert_fifty_times(rate_factory, monkeypatch):
    with ThreadPoolExecutor(max_workers=2) as workers:
        for offset in range(50):
            barrier = Barrier(2)

            def download(*args, barrier=barrier, **kwargs):
                index = barrier.wait(timeout=5)
                return Response(xml(cny=str(67 + index)))

            monkeypatch.setattr(urllib.request, "urlopen", download)
            day = DAY - timedelta(days=offset)
            futures = [
                workers.submit(service.get_rate, "CNY", day, session_factory=rate_factory)
                for _ in range(2)
            ]
            results = [future.result(timeout=10) for future in futures]
            assert results[0] == results[1]
            assert results[0].rate in (Decimal("67"), Decimal("68"))
            with rate_factory() as db:
                assert (
                    db.scalar(
                        select(func.count())
                        .select_from(ExchangeRate)
                        .where(ExchangeRate.rate_date == day, ExchangeRate.currency == "CNY")
                    )
                    == 1
                )


def test_api_contract_and_authorization(client, auth_client, rate_factory, feed):
    rate_schema = app.openapi()["components"]["schemas"]["RateOut"]["properties"]["rate"]
    assert rate_schema["type"] == "string"
    # auth_client shares client; remove its cookie to test authentication first.
    cookies = dict(client.cookies)
    client.cookies.clear()
    assert client.get("/api/rates?currency=CNY&date=2026-10-16").status_code == 401
    assert feed == []
    client.cookies.update(cookies)
    response = auth_client.get("/api/rates?currency=CNY&date=2026-10-16")
    assert response.status_code == 200
    assert response.json()["rate"] == "67.8700"
    assert auth_client.get("/api/rates?currency=EUR&date=2026-10-16").status_code == 422
    future = auth_client.get("/api/rates?currency=CNY&date=2026-10-21")
    assert future.status_code == 422 and future.json()["code"] == "rate_date_in_future"


def test_api_fallback_and_not_found(auth_client, rate_factory, monkeypatch):
    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: Response(b"broken"))
    response = auth_client.get("/api/rates?currency=CNY&date=2026-10-16")
    assert response.status_code == 404 and response.json()["code"] == "rate_not_found"
    seed(rate_factory, DAY - timedelta(days=1))
    response = auth_client.get("/api/rates?currency=CNY&date=2026-10-16")
    assert response.status_code == 200
    assert response.json() == {
        "currency": "CNY",
        "requested_date": "2026-10-16",
        "rate_date": "2026-10-15",
        "rate": "60.1234",
        "source": "nbk",
        "exact": False,
    }


def test_network_guard_cannot_be_swallowed_by_fallback(rate_factory):
    with pytest.raises(pytest.fail.Exception, match="Unexpected HTTP"):
        service.get_rate("CNY", DAY, session_factory=rate_factory)


def test_cli_skips_cached_dates_and_fetches_once_per_day(rate_factory, monkeypatch, capsys):
    seed(rate_factory)
    seed(rate_factory, currency="USD")
    calls, pauses = [], []

    def download(url, *, timeout):
        calls.append(url)
        return Response(xml())

    monkeypatch.setattr(urllib.request, "urlopen", download)
    monkeypatch.setattr(cli.time, "sleep", pauses.append)
    assert cli.main(["rates-fetch", "--from", "2026-10-16", "--to", "2026-10-18"]) == 0
    assert len(calls) == 2 and pauses == [1]
    assert "нет ответа" not in capsys.readouterr().out
    assert cli.main(["rates-fetch", "--from", "2026-10-16", "--to", "2026-10-18"]) == 0
    assert len(calls) == 2


def test_cli_partial_failure_is_not_success_from_previous_rate(rate_factory, monkeypatch, capsys):
    seed(rate_factory, DAY - timedelta(days=1))
    calls = []

    def download(url, *, timeout):
        calls.append(url)
        return Response(xml(cny=None))

    monkeypatch.setattr(urllib.request, "urlopen", download)
    assert cli.main(["rates-fetch", "--from", "2026-10-16", "--to", "2026-10-16"]) == 1
    assert len(calls) == 1
    output = capsys.readouterr().out
    assert "CNY     нет ответа" in output and "USD     454.1400" in output


def test_cli_currency_selection_and_duplicates(rate_factory, feed, capsys):
    assert (
        cli.main(
            [
                "rates-fetch",
                "--from",
                "2026-10-16",
                "--to",
                "2026-10-16",
                "--currency",
                "USD",
                "--currency",
                "USD",
            ]
        )
        == 0
    )
    output = capsys.readouterr().out
    assert "CNY" not in output and output.count("USD") == 1 and len(feed) == 1


@pytest.mark.parametrize(
    "start,end,extra",
    [
        ("2026-10-17", "2026-10-16", []),
        ("2025-01-01", "2026-02-05", []),
        ("2026-10-16", "2026-10-21", []),
        ("bad", "2026-10-16", []),
        ("2026-10-16", "2026-10-16", ["--currency", "EUR"]),
    ],
)
def test_cli_invalid_arguments(start, end, extra):
    with pytest.raises(SystemExit) as exc:
        cli.main(["rates-fetch", "--from", start, "--to", end, *extra])
    assert exc.value.code == 2


def test_cli_accepts_exactly_four_hundred_days(monkeypatch):
    calls = []
    monkeypatch.setattr(cli, "rates_fetch_command", lambda *args: calls.append(args) or 0)
    end = DAY
    start = end - timedelta(days=399)
    assert cli.main(["rates-fetch", "--from", start.isoformat(), "--to", end.isoformat()]) == 0
    assert calls == [(start, end, ["CNY", "USD"])]
