import urllib.request
import uuid
from datetime import date
from decimal import Decimal
from unittest.mock import Mock

from fastapi.testclient import TestClient
from sqlalchemy import event, select
from sqlalchemy.orm import sessionmaker

from app.db import get_db
from app.main import app
from app.rates import service as rates
from app.rates.models import ExchangeRate
from app.rates.router import get_rate_session_factory
from app.receipts.schemas import ReceiptCreate
from app.receipts.service import post_receipt
from app.sales.schemas import SaleCreate
from app.sales.service import post_sale
from tests.factories import create_product, create_user
from tests.test_rates import Response, xml


def test_read_apis_use_independent_rate_sessions_and_only_cache_commits(
    isolated_stock_engine, monkeypatch
):
    factory = sessionmaker(bind=isolated_stock_engine, expire_on_commit=False)
    today = date(2026, 10, 20)
    monkeypatch.setattr(rates, "today_local", lambda: today)
    with factory() as db:
        user = create_user(db, username="owner", password="test-password").id
        pid = create_product(db, sale_price=1_450_000).id
        db.add(
            ExchangeRate(
                currency="CNY", rate_date=date(2026, 10, 1), rate=Decimal("70"), source="nbk"
            )
        )
        db.commit()
        post_receipt(
            db,
            ReceiptCreate(
                request_id=uuid.uuid4(),
                received_at="2026-10-10T10:00:00Z",
                currency="CNY",
                exchange_rate="70",
                rate_source="nbk",
                rate_date="2026-10-01",
                lines=[{"product_id": pid, "qty": 100, "unit_price_minor": 10000}],
            ),
            user,
        )
        post_sale(
            db,
            SaleCreate(
                request_id=uuid.uuid4(),
                sold_at="2026-10-11T10:00:00Z",
                paid_amount=1450000,
                lines=[{"product_id": pid, "qty": 1, "unit_price": 1450000}],
            ),
            user,
        )
    download = Mock(return_value=Response(xml(cny="85", usd="500", published="20.10.2026")))
    monkeypatch.setattr(urllib.request, "urlopen", download)
    commits, rate_sessions = [], []

    def regular_db():
        with factory() as db:
            yield db

    def guarded_db():
        with factory() as db:
            commit = Mock(side_effect=AssertionError("Valuation session must not commit"))
            db.commit = commit
            commits.append(commit)

            def read_only(conn, cursor, statement, parameters, context, executemany):
                sql = " ".join(statement.upper().split())
                assert sql.startswith("SELECT ") and "FOR UPDATE" not in sql, sql

            connection = db.connection()
            event.listen(connection, "before_cursor_execute", read_only)
            try:
                yield db
            finally:
                event.remove(connection, "before_cursor_execute", read_only)

    def rate_factory():
        session = factory()
        rate_sessions.append(session)
        return session

    app.dependency_overrides[get_db] = regular_db
    app.dependency_overrides[get_rate_session_factory] = lambda: rate_factory
    try:
        with TestClient(app) as client:
            assert (
                client.post(
                    "/api/auth/login", json={"username": "owner", "password": "test-password"}
                ).status_code
                == 200
            )
            app.dependency_overrides[get_db] = guarded_db
            for path in (
                f"/api/products/{pid}/buy-today",
                "/api/stock/buy-today",
                "/api/reports/summary?from=2026-10-11&to=2026-10-11",
            ):
                response = client.get(path)
                assert response.status_code == 200, response.text
            assert response.json()["buy_today_cost"] == 850000
            download.assert_called_once()
            assert all(not session.in_transaction() for session in rate_sessions)
            for commit in commits:
                commit.assert_not_called()
        with factory() as db:
            assert db.scalar(
                select(ExchangeRate.rate).where(
                    ExchangeRate.currency == "CNY", ExchangeRate.rate_date == today
                )
            ) == Decimal("85.0000")
    finally:
        app.dependency_overrides.clear()
