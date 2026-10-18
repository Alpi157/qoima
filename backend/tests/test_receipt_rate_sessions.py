"""Exercise real get_rate sessions and cache writes through the receipt preview router."""

import urllib.request
from datetime import date
from unittest.mock import Mock

from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from sqlalchemy.orm import sessionmaker

from app.db import get_db
from app.main import app
from app.rates import service as rates
from app.rates.models import ExchangeRate
from app.rates.router import get_rate_session_factory
from app.receipts.models import Receipt
from tests.factories import create_product, create_user
from tests.test_rates import Response, xml


def test_preview_uses_independent_rate_sessions_and_only_cache_commits(
    isolated_stock_engine, monkeypatch
):
    factory = sessionmaker(bind=isolated_stock_engine)
    with factory() as db:
        create_user(db, username="owner", password="test-password")
        pid = create_product(db, sale_price=100_000).id
        db.commit()
    document_commits, rate_sessions = [], []

    def document_db():
        with factory() as db:
            commit = Mock(side_effect=AssertionError("Preview session must not commit"))
            db.commit = commit
            document_commits.append(commit)

            # Includes authentication: this connection must execute reads only.
            def read_only(conn, cursor, statement, parameters, context, executemany):
                sql = " ".join(statement.upper().split())
                assert sql.startswith("SELECT ") and "FOR UPDATE" not in sql, sql

            event.listen(db.connection(), "before_cursor_execute", read_only)
            yield db

    def rate_factory():
        db = factory()
        rate_sessions.append(db)
        return db

    monkeypatch.setattr(rates, "today_local", lambda: date(2026, 10, 20))
    download = Mock(return_value=Response(xml(cny="70")))
    monkeypatch.setattr(urllib.request, "urlopen", download)

    # Login has its normal commit; replace get_db with the guarded sessions afterwards.
    def regular_db():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = regular_db
    app.dependency_overrides[get_rate_session_factory] = lambda: rate_factory
    try:
        with TestClient(app) as client:
            assert (
                client.post(
                    "/api/auth/login",
                    json={
                        "username": "owner",
                        "password": "test-password",
                    },
                ).status_code
                == 200
            )
            app.dependency_overrides[get_db] = document_db
            response = client.post(
                "/api/receipts/preview",
                json={
                    "received_at": "2026-10-16T12:00:00Z",
                    "currency": "CNY",
                    "exchange_rate": "77.0001",
                    "rate_source": "manual",
                    "lines": [{"product_id": pid, "qty": 1, "unit_price_minor": 100}],
                },
            )
            assert response.status_code == 200, response.text
            assert response.json()["warnings"][0]["params"]["nbk_exact"] is True
            assert len(rate_sessions) == 3
            assert all(not db.in_transaction() for db in rate_sessions)
            download.assert_called_once()
            for commit in document_commits:
                commit.assert_not_called()
        with factory() as db:
            assert db.scalar(select(func.count()).select_from(ExchangeRate)) == 2
            assert db.scalar(select(func.count()).select_from(Receipt)) == 0
    finally:
        app.dependency_overrides.clear()
