import uuid

import pytest
from sqlalchemy import event, select, text

from app.catalog import service as catalog
from app.receipts.models import ReceiptLine
from tests.factories import create_product


def receive(client, pid, *, currency="KZT", at="2026-10-14T12:00:00Z", supplier=None, price=100):
    data = {
        "request_id": str(uuid.uuid4()),
        "received_at": at,
        "supplier": supplier,
        "lines": [{"product_id": pid, "qty": 1, "unit_price_minor": price}],
    }
    if currency != "KZT":
        data.update(
            currency=currency, exchange_rate="70", rate_source="nbk", rate_date="2026-10-01"
        )
    response = client.post("/api/receipts", json=data)
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def hints_case(db_session):
    from datetime import date
    from decimal import Decimal

    from app.rates.models import ExchangeRate

    for currency in ("CNY", "USD"):
        db_session.add(
            ExchangeRate(
                rate_date=date(2026, 10, 1), currency=currency, rate=Decimal("70"), source="nbk"
            )
        )
    db_session.flush()
    return create_product(db_session).id


def test_last_purchase_fields_follow_known_last_cost(auth_client, db_session, hints_case):
    pid = hints_case

    def hints():
        product = auth_client.get(f"/api/products/{pid}").json()
        calculated = auth_client.post(
            "/api/receipts/preview",
            json={"lines": [{"product_id": pid, "qty": 1, "unit_price_minor": 100}]},
        )
        assert calculated.status_code == 200
        assert calculated.json()["lines"][0]["previous_cost"] == product["last_cost"]
        return (
            product["last_cost"],
            product["last_purchase_currency"],
            product["last_purchase_price_minor"],
        )

    assert hints() == (None, None, None)
    first = receive(auth_client, pid)
    assert hints() == (100, "KZT", 100)
    cny = receive(auth_client, pid, currency="CNY", at="2026-10-15T12:00:00Z", price=200)
    assert hints() == (14_000, "CNY", 200)
    receive(auth_client, pid, currency="USD", at="2026-10-13T12:00:00Z", price=300)
    assert hints() == (14_000, "CNY", 200)
    assert (
        auth_client.post(f"/api/receipts/{cny['id']}/cancel", json={"reason": "Ошибка"}).status_code
        == 200
    )
    assert hints() == (100, "KZT", 100)
    # Historical lines were backfilled to KZT and unit_price_minor=unit_cost in 26a-1.
    row = db_session.scalar(select(ReceiptLine).where(ReceiptLine.receipt_id == first["id"]))
    assert row.unit_price_minor == row.unit_cost
    newer = receive(auth_client, pid, currency="CNY", at="2026-10-15T12:00:00Z", price=400)
    db_session.execute(
        text(
            "UPDATE receipt_lines SET unit_cost=NULL,unit_price_minor=NULL,goods_total=NULL "
            "WHERE receipt_id=:id"
        ),
        {"id": newer["id"]},
    )
    assert hints() == (100, "KZT", 100)
    receive(auth_client, pid, currency="USD", price=0)
    assert hints() == (0, "USD", 0)


def test_hints_query_count_does_not_grow(auth_client, db_session, hints_case):
    receive(auth_client, hints_case, currency="CNY", price=200)
    connection = db_session.connection()
    statements = []

    def record(*args):
        statements.append(args[2])

    event.listen(connection, "before_cursor_execute", record)
    try:
        for q in (None, ""):
            items = catalog.search_products(db_session, q, False, 200, 0).items
            assert len(statements) == 2 and items[0].last_purchase_currency == "CNY"
            statements.clear()
        for _ in range(20):
            create_product(db_session)
        statements.clear()
        for q in (None, "С"):
            catalog.search_products(db_session, q, False, 200, 0)
            assert len(statements) == 2
            statements.clear()
    finally:
        event.remove(connection, "before_cursor_execute", record)


def test_defaults_empty_database(auth_client):
    for supplier in (None, "", "  ", "Unknown"):
        params = {} if supplier is None else {"supplier": supplier}
        assert auth_client.get("/api/receipts/defaults", params=params).json() == {
            "currency": "KZT",
            "source": "default",
        }


def test_defaults_supplier_last_cancelled_and_backdated(auth_client, hints_case):
    pid = hints_case
    receive(auth_client, pid, supplier=" Supplier ", currency="CNY")
    receive(auth_client, pid, supplier="Other", currency="USD", at="2026-10-15T12:00:00Z")
    receive(auth_client, pid, supplier="SUPPLIER", currency="KZT", at="2026-10-13T12:00:00Z")
    cancelled = receive(auth_client, pid, supplier="supplier", at="2026-10-16T12:00:00Z")
    assert (
        auth_client.post(
            f"/api/receipts/{cancelled['id']}/cancel", json={"reason": "Ошибка"}
        ).status_code
        == 200
    )
    for supplier, currency, source in [
        ("  sUpPlIeR ", "CNY", "supplier"),
        ("unknown", "USD", "last"),
        ("", "USD", "last"),
        ("  ", "USD", "last"),
    ]:
        assert auth_client.get("/api/receipts/defaults", params={"supplier": supplier}).json() == {
            "currency": currency,
            "source": source,
        }


def test_defaults_only_cancelled_receipt(auth_client, hints_case):
    posted = receive(auth_client, hints_case, currency="CNY", supplier="Supplier")
    auth_client.post(f"/api/receipts/{posted['id']}/cancel", json={"reason": "Ошибка"})
    assert auth_client.get("/api/receipts/defaults?supplier=Supplier").json() == {
        "currency": "KZT",
        "source": "default",
    }
