import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.rates.models import ExchangeRate
from app.receipts.models import ReceiptLine
from tests.factories import create_product


def test_purchases_require_login(client):
    assert client.get("/api/products/1/purchases").status_code == 401


@pytest.mark.parametrize("query", ["limit=0", "limit=101", "offset=-1"])
def test_purchase_pagination_validation(auth_client, query):
    assert auth_client.get("/api/products/1/purchases?" + query).status_code == 422


def test_missing_product_and_empty_history(auth_client, db_session):
    assert auth_client.get("/api/products/999999999/purchases").status_code == 404
    product = create_product(db_session)
    assert auth_client.get(f"/api/products/{product.id}/purchases").json() == {
        "items": [],
        "total": 0,
    }


def test_purchases_saved_totals_order_cancelled_unknown_and_paging(auth_client, db_session):
    product = create_product(db_session)
    other = create_product(db_session)
    db_session.add(
        ExchangeRate(
            rate_date=date(2026, 10, 1), currency="CNY", rate=Decimal("67.8300"), source="nbk"
        )
    )
    db_session.flush()

    def receive(pid=product.id, **changes):
        payload = {
            "request_id": str(uuid.uuid4()),
            "received_at": "2026-10-10T10:00:00Z",
            "lines": [{"product_id": pid, "qty": 3, "unit_price_minor": 3333}],
            **changes,
        }
        response = auth_client.post("/api/receipts", json=payload)
        assert response.status_code == 201, response.text
        return response.json()

    earlier = receive(received_at="2026-10-09T10:00:00Z")
    foreign = receive(
        currency="CNY", exchange_rate="67.8300", rate_source="nbk", rate_date="2026-10-01"
    )
    unknown = receive()
    line = db_session.scalar(select(ReceiptLine).where(ReceiptLine.receipt_id == unknown["id"]))
    line.unit_price_minor = line.goods_total = line.unit_cost = None
    db_session.flush()
    cancelled = receive()
    assert (
        auth_client.post(
            f"/api/receipts/{cancelled['id']}/cancel", json={"reason": "Ошибка"}
        ).status_code
        == 200
    )
    receive(other.id)
    page = auth_client.get(f"/api/products/{product.id}/purchases?limit=2").json()
    assert page["total"] == 3
    assert [item["receipt_id"] for item in page["items"]] == [unknown["id"], foreign["id"]]
    assert page["items"][0]["total"] is None
    assert page["items"][0]["unit_cost"] is None
    assert page["items"][1] == {
        "receipt_id": foreign["id"],
        "receipt_number": foreign["number"],
        "received_at": foreign["received_at"],
        "currency": "CNY",
        "exchange_rate": "67.8300",
        "unit_price_minor": 3333,
        "qty": 3,
        "unit_cost": 226077,
        "total": 678232,
    }
    rest = auth_client.get(f"/api/products/{product.id}/purchases?limit=2&offset=2").json()
    assert [item["receipt_id"] for item in rest["items"]] == [earlier["id"]]
    assert auth_client.get(f"/api/products/{product.id}/purchases?offset=3").json()["items"] == []


def test_purchase_total_includes_saved_expenses(auth_client, db_session):
    product = create_product(db_session)
    receipt = auth_client.post(
        "/api/receipts",
        json={
            "request_id": str(uuid.uuid4()),
            "lines": [{"product_id": product.id, "qty": 3, "unit_price_minor": 10000}],
            "expenses": [{"kind": "delivery", "amount_minor": 10000}],
        },
    )
    assert receipt.status_code == 201
    item = auth_client.get(f"/api/products/{product.id}/purchases").json()["items"][0]
    assert item["total"] == 40000
    assert item["unit_cost"] == 13333
