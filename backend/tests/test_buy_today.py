import uuid
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import Mock

import pytest
from sqlalchemy import event, func, select

from app.buy_today import service
from app.errors import RateNotFoundError
from app.inventory.models import StockMovement
from app.price_quotes.models import ProductPriceQuote
from app.rates import service as rates_service
from app.rates.models import ExchangeRate
from app.rates.schemas import RateOut
from app.receipts.models import Receipt, ReceiptLine
from tests.factories import create_product

TODAY = date(2026, 10, 20)


@pytest.fixture
def current_rates(monkeypatch):
    monkeypatch.setattr(rates_service, "today_local", lambda: TODAY)
    get = Mock(
        side_effect=lambda currency, requested_date, **kwargs: RateOut(
            currency=currency,
            requested_date=requested_date,
            rate_date=requested_date,
            rate=Decimal("85.0000" if currency == "CNY" else "500.0000"),
            exact=True,
        )
    )
    monkeypatch.setattr(rates_service, "get_rate", get)
    return get


@pytest.fixture
def purchase(auth_client, db_session, current_rates):
    db_session.add(
        ExchangeRate(
            currency="CNY", rate_date=date(2026, 10, 1), rate=Decimal("70.0000"), source="nbk"
        )
    )
    db_session.flush()

    def receive(product=None, **changes):
        product = product or create_product(db_session, sale_price=1_450_000)
        payload = {
            "request_id": str(uuid.uuid4()),
            "received_at": "2026-10-10T10:00:00Z",
            "currency": "CNY",
            "exchange_rate": "70.0000",
            "rate_source": "nbk",
            "rate_date": "2026-10-01",
            "lines": [{"product_id": product.id, "qty": 100, "unit_price_minor": 10000}],
            "expenses": [
                {"kind": "delivery", "amount_minor": 7_000_000},
                {"kind": "customs_duty", "amount_minor": 3_500_000},
            ],
            **changes,
        }
        response = auth_client.post("/api/receipts", json=payload)
        assert response.status_code == 201, response.text
        return product, response.json()

    return receive


def quote(client, pid, **changes):
    response = client.post(
        f"/api/products/{pid}/price-quotes",
        json={
            "request_id": str(uuid.uuid4()),
            "currency": "CNY",
            "price_minor": 12_000,
            "quoted_on": TODAY.isoformat(),
            **changes,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_endpoints_require_login(client):
    for path in ("/api/products/1/buy-today", "/api/stock/buy-today"):
        assert client.get(path).status_code == 401
    assert client.post("/api/products/1/price-quotes", json={}).status_code == 401
    assert client.post("/api/price-quotes/1/cancel").status_code == 401


def test_product_purchase_reference_7_and_archived(auth_client, db_session, purchase):
    product, receipt = purchase()
    product.is_archived = True
    db_session.flush()
    result = auth_client.get(f"/api/products/{product.id}/buy-today").json()
    assert {
        key: result[key]
        for key in (
            "basis",
            "basis_date",
            "basis_receipt_id",
            "currency",
            "price_minor",
            "cost_then",
            "avg_cost",
            "today_rate",
            "today_rate_date",
            "today_rate_exact",
            "goods_today",
            "expenses_revalued",
            "expenses_fixed",
            "buy_today",
            "markup_then",
            "markup_now",
            "price_to_keep_markup",
            "difference_vs_avg",
            "reason_unavailable",
        )
    } == {
        "basis": "purchase",
        "basis_date": "2026-10-10",
        "basis_receipt_id": receipt["id"],
        "currency": "CNY",
        "price_minor": 10000,
        "cost_then": 805000,
        "avg_cost": 805000,
        "today_rate": "85.0000",
        "today_rate_date": TODAY.isoformat(),
        "today_rate_exact": True,
        "goods_today": 850000,
        "expenses_revalued": 42500,
        "expenses_fixed": 70000,
        "buy_today": 962500,
        "markup_then": 80,
        "markup_now": 51,
        "price_to_keep_markup": 1732500,
        "difference_vs_avg": 157500,
        "reason_unavailable": None,
    }


def test_quote_newer_older_and_cancellation_fallbacks(auth_client, db_session, purchase):
    product, receipt = purchase()
    before = auth_client.get(f"/api/products/{product.id}").json()
    movement_count = db_session.scalar(select(func.count()).select_from(StockMovement))
    old = quote(auth_client, product.id, quoted_on="2026-10-09")

    def read():
        return auth_client.get(f"/api/products/{product.id}/buy-today").json()

    assert read()["basis"] == "purchase"
    first = quote(auth_client, product.id, quoted_on="2026-10-11", price_minor=11_000)
    latest = quote(auth_client, product.id)
    assert read()["basis"] == "quote"
    assert read()["buy_today"] == 1_132_500
    assert read()["cost_then"] == 805_000
    assert read()["basis_receipt_id"] == receipt["id"]
    assert read()["active_quote"]["cancel_fallback_basis"] == "quote"
    assert auth_client.post(f"/api/price-quotes/{latest['id']}/cancel").status_code == 200
    assert read()["active_quote"]["id"] == first["id"]
    assert read()["active_quote"]["cancel_fallback_basis"] == "purchase"
    assert auth_client.post(f"/api/price-quotes/{first['id']}/cancel").status_code == 200
    assert read()["basis"] == "purchase"
    assert read()["active_quote"]["id"] == old["id"]
    assert auth_client.get(f"/api/products/{product.id}").json() == before
    assert db_session.scalar(select(func.count()).select_from(StockMovement)) == movement_count


def test_quote_same_local_day_compares_posting_time(auth_client, db_session, purchase):
    product, receipt_out = purchase(received_at="2026-10-09T20:30:00Z")
    saved = quote(auth_client, product.id, quoted_on="2026-10-10")
    receipt = db_session.get(Receipt, receipt_out["id"])
    q = db_session.get(ProductPriceQuote, saved["id"])
    for delta, basis in [
        (timedelta(seconds=-1), "purchase"),
        (timedelta(0), "purchase"),
        (timedelta(seconds=1), "quote"),
    ]:
        q.created_at = receipt.created_at + delta
        db_session.flush()
        assert auth_client.get(f"/api/products/{product.id}/buy-today").json()["basis"] == basis


def test_no_basis_quote_alone_and_cancel(auth_client, db_session, current_rates):
    product = create_product(db_session)
    path = f"/api/products/{product.id}/buy-today"
    assert auth_client.get(path).json()["reason_unavailable"] == "no_purchase"
    q = quote(auth_client, product.id)
    result = auth_client.get(path).json()
    assert result["basis"] == "quote" and result["buy_today"] == 1_020_000
    assert result["expenses_known"] is False and result["cost_then"] is None
    assert result["expenses_fixed"] == result["expenses_revalued"] == 0
    assert result["markup_then"] is result["price_to_keep_markup"] is None
    assert result["active_quote"]["cancel_fallback_basis"] is None
    assert auth_client.post(f"/api/price-quotes/{q['id']}/cancel").status_code == 200
    assert auth_client.get(path).json()["reason_unavailable"] == "no_purchase"
    assert auth_client.get("/api/products/999999999/buy-today").status_code == 404


def test_fallback_and_no_rate(auth_client, purchase, current_rates):
    product, _ = purchase()
    current_rates.side_effect = lambda currency, requested_date, **kwargs: RateOut(
        currency=currency,
        requested_date=requested_date,
        rate_date=requested_date - timedelta(days=2),
        rate=Decimal("60.0000"),
        exact=False,
    )
    result = auth_client.get(f"/api/products/{product.id}/buy-today").json()
    assert (
        result["buy_today"],
        result["difference_vs_avg"],
        result["today_rate_exact"],
        result["today_rate_date"],
    ) == (700000, -105000, False, "2026-10-18")
    current_rates.side_effect = RateNotFoundError()
    result = auth_client.get(f"/api/products/{product.id}/buy-today").json()
    assert result["basis"] == "purchase" and result["reason_unavailable"] == "no_rate"
    assert result["buy_today"] is None and result["rates"][0]["rate"] is None


def test_quote_idempotency_cancel_and_validation(auth_client, db_session, current_rates):
    product = create_product(db_session)
    payload = {
        "request_id": str(uuid.uuid4()),
        "currency": "USD",
        "price_minor": 100,
        "quoted_on": TODAY.isoformat(),
    }
    path = f"/api/products/{product.id}/price-quotes"
    first = auth_client.post(path, json=payload)
    assert first.status_code == 201
    repeat = auth_client.post(path, json=payload)
    assert repeat.status_code == 200 and repeat.json() == first.json()
    conflict = auth_client.post(path, json={**payload, "price_minor": 101})
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "price_quote_request_conflict"
    assert conflict.json()["params"] == {"id": first.json()["id"]}
    other = create_product(db_session)
    assert (
        auth_client.post(f"/api/products/{other.id}/price-quotes", json=payload).status_code == 409
    )
    cancel_path = f"/api/price-quotes/{first.json()['id']}/cancel"
    assert auth_client.post(cancel_path).json()["cancelled_by"] is not None
    assert auth_client.post(cancel_path).json()["code"] == "price_quote_already_cancelled"
    assert auth_client.post(path, json=payload).json()["status"] == "cancelled"
    for changes in (
        {"quoted_on": "2026-10-21"},
        {"price_minor": 0},
        {"price_minor": 1.5},
        {"price_minor": "100"},
        {"currency": "EUR"},
    ):
        assert auth_client.post(path, json={**payload, **changes}).status_code == 422
    assert auth_client.post("/api/price-quotes/999999999/cancel").status_code == 404
    assert (
        auth_client.post(
            "/api/products/999999999/price-quotes",
            json={**payload, "request_id": str(uuid.uuid4())},
        ).status_code
        == 404
    )


def test_last_known_purchase_order_unknown_and_cancelled(auth_client, db_session, purchase):
    product, first = purchase()
    _, last = purchase(product)
    _, unknown = purchase(product)
    line = db_session.scalar(select(ReceiptLine).where(ReceiptLine.receipt_id == unknown["id"]))
    line.unit_cost = line.unit_price_minor = line.goods_total = None
    db_session.flush()

    def read():
        return auth_client.get(f"/api/products/{product.id}/buy-today").json()

    assert read()["basis_receipt_id"] == last["id"]
    assert (
        auth_client.post(
            f"/api/receipts/{last['id']}/cancel", json={"reason": "Ошибка"}
        ).status_code
        == 200
    )
    assert read()["basis_receipt_id"] == first["id"]


def test_stock_reference_10_groups_archived_missing_and_constant_queries(
    auth_client, db_session, purchase, current_rates
):
    product, _ = purchase()
    product.is_archived = True
    db_session.flush()
    result = auth_client.get("/api/stock/buy-today").json()
    assert result["total"] == {
        "cost_value": 80_500_000,
        "buy_today_value": 96_250_000,
        "difference": 15_750_000,
        "difference_percent": "19.6",
    }
    assert result["groups"][0]["products_count"] == 1
    counts = []
    for count in (1, 8):
        for _ in range(count):
            purchase()
        statements = []

        def record(
            conn, cursor, statement, parameters, context, executemany, statements=statements
        ):
            statements.append(statement)

        conn = db_session.connection()
        event.listen(conn, "before_cursor_execute", record)
        current_rates.reset_mock()
        try:
            service.stock_buy_today(db_session, session_factory=lambda: None)
        finally:
            event.remove(conn, "before_cursor_execute", record)
        counts.append(len(statements))
        assert current_rates.call_count == 1
    assert counts == [4, 4]


def test_stock_empty(auth_client, current_rates):
    assert auth_client.get("/api/stock/buy-today").json() == {
        "groups": [],
        "total": {
            "cost_value": 0,
            "buy_today_value": 0,
            "difference": 0,
            "difference_percent": None,
        },
        "rates": [],
        "without_basis_count": 0,
        "without_basis_cost_value": 0,
    }
    current_rates.assert_not_called()


def test_saved_manual_and_selected_allocations_are_not_redistributed(
    auth_client, db_session, purchase
):
    first = create_product(db_session, sale_price=1_450_000)
    second = create_product(db_session, sale_price=1_450_000)
    purchase(
        first,
        lines=[
            {"product_id": first.id, "qty": 100, "unit_price_minor": 10000},
            {"product_id": second.id, "qty": 200, "unit_price_minor": 2500},
        ],
        expenses=[
            {
                "kind": "delivery",
                "amount_minor": 1001,
                "allocation_method": "selected",
                "product_ids": [first.id],
            },
            {
                "kind": "other",
                "amount_minor": 101,
                "allocation_method": "manual",
                "manual": [
                    {"product_id": first.id, "amount_tiyn": 100},
                    {"product_id": second.id, "amount_tiyn": 1},
                ],
            },
        ],
    )
    a = auth_client.get(f"/api/products/{first.id}/buy-today").json()
    b = auth_client.get(f"/api/products/{second.id}/buy-today").json()
    assert (a["buy_today"], b["buy_today"]) == (850011, 212500)
    quote(auth_client, first.id, price_minor=20_000)
    assert auth_client.get(f"/api/products/{first.id}/buy-today").json()["buy_today"] == 1700011


def test_usd_expense_and_missing_expense_rate_are_isolated(
    auth_client, db_session, purchase, current_rates
):
    db_session.add(
        ExchangeRate(
            currency="USD", rate_date=date(2026, 10, 1), rate=Decimal("450.0000"), source="nbk"
        )
    )
    db_session.flush()
    product, _ = purchase(
        expenses=[
            {
                "kind": "delivery",
                "currency": "USD",
                "amount_minor": 100,
                "exchange_rate": "450.0000",
                "rate_source": "nbk",
                "rate_date": "2026-10-01",
            }
        ]
    )
    result = auth_client.get(f"/api/products/{product.id}/buy-today").json()
    assert result["expenses_revalued"] == 500 and result["buy_today"] == 850500
    assert {rate["currency"] for rate in result["rates"]} == {"CNY", "USD"}
    other = create_product(db_session)
    quote(auth_client, other.id)

    def lookup(currency, requested_date, **kwargs):
        if currency == "USD":
            raise RateNotFoundError()
        return RateOut(
            currency=currency,
            requested_date=requested_date,
            rate_date=requested_date,
            rate=Decimal("85"),
            exact=True,
        )

    current_rates.side_effect = lookup
    failed = auth_client.get(f"/api/products/{product.id}/buy-today").json()
    assert failed["reason_unavailable"] == "no_rate" and failed["today_rate"] == "85.0000"
    assert auth_client.get(f"/api/products/{other.id}/buy-today").json()["buy_today"] == 1_020_000


def test_stock_groups_and_unknown_average_are_separate(
    auth_client, db_session, purchase, current_rates
):
    from app.inventory.service import MovementIn, post_movements
    from tests.factories import create_user

    user = create_user(db_session)
    purchase()
    for currency in ("KZT", "USD"):
        p = create_product(db_session, sale_price=100000)
        assert (
            auth_client.post(
                "/api/receipts",
                json={
                    "request_id": str(uuid.uuid4()),
                    "received_at": "2026-10-09T10:00:00Z",
                    "lines": [{"product_id": p.id, "qty": 2, "unit_cost": 1000}],
                },
            ).status_code
            == 201
        )
        if currency == "USD":
            quote(auth_client, p.id, currency="USD", price_minor=100)
    no_purchase = create_product(db_session)
    no_avg = create_product(db_session)
    post_movements(
        db_session,
        [
            MovementIn(no_purchase.id, 3, "adjustment", unit_cost=77),
            MovementIn(no_avg.id, 2, "adjustment"),
        ],
        user.id,
    )
    db_session.flush()
    quote(auth_client, no_avg.id)
    current_rates.reset_mock()
    result = auth_client.get("/api/stock/buy-today").json()
    assert [group["currency"] for group in result["groups"]] == ["KZT", "CNY", "USD"]
    assert result["without_basis_count"] == 2
    assert result["without_basis_cost_value"] == 231
    assert result["total"]["cost_value"] == 80_504_000
    assert result["total"]["buy_today_value"] == 96_352_000
    assert current_rates.call_count == 2


@pytest.mark.parametrize("condition, expected", [("good", 40 * 962500), ("defective", 50 * 962500)])
def test_summary_reference_11_and_returns(auth_client, purchase, condition, expected):
    product, _ = purchase()
    sale = auth_client.post(
        "/api/sales",
        json={
            "request_id": str(uuid.uuid4()),
            "sold_at": "2026-10-11T10:00:00Z",
            "paid_amount": 72_500_000,
            "lines": [{"product_id": product.id, "qty": 50, "unit_price": 1_450_000}],
        },
    )
    assert sale.status_code == 201, sale.text
    summary_path = "/api/reports/summary?from=2026-10-11&to=2026-10-12"
    before = auth_client.get(summary_path).json()
    assert (before["buy_today_cost"], before["cost"], before["buy_today_unknown_count"]) == (
        48_125_000,
        40_250_000,
        0,
    )
    returned = auth_client.post(
        "/api/returns",
        json={
            "request_id": str(uuid.uuid4()),
            "sale_id": sale.json()["id"],
            "returned_at": "2026-10-12T10:00:00Z",
            "lines": [
                {"sale_line_id": sale.json()["lines"][0]["id"], "qty": 10, "condition": condition}
            ],
        },
    )
    assert returned.status_code == 201, returned.text
    after = auth_client.get(summary_path).json()
    assert after["buy_today_cost"] == expected
    only_return = auth_client.get("/api/reports/summary?from=2026-10-12&to=2026-10-12").json()
    assert only_return["buy_today_cost"] == (-9_625_000 if condition == "good" else 0)
    assert (
        auth_client.post(
            f"/api/returns/{returned.json()['id']}/cancel", json={"reason": "Ошибка"}
        ).status_code
        == 200
    )
    assert auth_client.get(summary_path).json()["buy_today_cost"] == 48_125_000


@pytest.mark.parametrize("condition,count", [("good", 2), ("defective", 1)])
def test_summary_unknown_counts_lines_without_netting(
    auth_client, db_session, current_rates, condition, count
):
    from app.inventory.service import MovementIn, post_movements
    from tests.factories import create_user

    product = create_product(db_session)
    user = create_user(db_session)
    post_movements(db_session, [MovementIn(product.id, 10, "adjustment")], user.id)
    db_session.flush()
    sold = auth_client.post(
        "/api/sales",
        json={
            "request_id": str(uuid.uuid4()),
            "sold_at": "2026-10-11T10:00:00Z",
            "paid_amount": 1000,
            "lines": [{"product_id": product.id, "qty": 10, "unit_price": 100}],
        },
    )
    assert sold.status_code == 201, sold.text
    returned = auth_client.post(
        "/api/returns",
        json={
            "request_id": str(uuid.uuid4()),
            "sale_id": sold.json()["id"],
            "returned_at": "2026-10-12T10:00:00Z",
            "lines": [
                {"sale_line_id": sold.json()["lines"][0]["id"], "qty": 10, "condition": condition}
            ],
        },
    )
    assert returned.status_code == 201, returned.text
    result = auth_client.get("/api/reports/summary?from=2026-10-11&to=2026-10-12").json()
    assert result["buy_today_cost"] == 0 and result["buy_today_unknown_count"] == count
