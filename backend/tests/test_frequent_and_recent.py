import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.catalog.models import Product
from app.customers.models import Customer
from app.inventory.service import MovementIn, post_movements
from tests.factories import create_customer, create_product, create_user


def _receive(db: Session, product: Product, qty: int) -> None:
    user = create_user(db)
    post_movements(db, [MovementIn(product.id, qty, "receipt")], user.id)


def _stocked(db: Session, article: str) -> Product:
    product = create_product(db, article=article, name=f"Товар {article}", sale_price=100_00)
    _receive(db, product, 100)
    return product


def _sell(
    client: TestClient,
    products: list[Product],
    customer: Customer | None = None,
    sold_at: datetime | None = None,
) -> dict:
    payload: dict[str, object] = {
        "request_id": str(uuid.uuid4()),
        "lines": [{"product_id": p.id, "qty": 1} for p in products],
    }
    if customer is not None:
        payload["customer_id"] = customer.id
    if sold_at is not None:
        payload["sold_at"] = sold_at.isoformat()
    response = client.post("/api/sales", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def _cancel(client: TestClient, sale_id: int) -> None:
    response = client.post(f"/api/sales/{sale_id}/cancel", json={"reason": "Қате енгізілді"})
    assert response.status_code == 200, response.text


def _frequent(client: TestClient, **params: object) -> list[dict]:
    response = client.get("/api/products/frequent", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _recent(client: TestClient, **params: object) -> list[dict]:
    response = client.get("/api/customers/recent", params=params)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize("path", ["/api/products/frequent", "/api/customers/recent"])
def test_require_login(client: TestClient, path: str) -> None:
    assert client.get(path).status_code == 401


@pytest.mark.parametrize("path", ["/api/products/frequent", "/api/customers/recent"])
@pytest.mark.parametrize("limit", [0, 21, -1])
def test_limit_out_of_range(auth_client: TestClient, path: str, limit: int) -> None:
    assert auth_client.get(path, params={"limit": limit}).status_code == 422


def test_frequent_without_sales_is_empty(auth_client: TestClient, db_session: Session) -> None:
    _stocked(db_session, "OC90")
    assert _frequent(auth_client) == []


def test_frequent_by_number_of_sales_then_article(
    auth_client: TestClient, db_session: Session
) -> None:
    a = _stocked(db_session, "A1")
    b = _stocked(db_session, "B2")
    c = _stocked(db_session, "C3")
    _sell(auth_client, [c])
    _sell(auth_client, [c, b])
    _sell(auth_client, [c, b])
    _sell(auth_client, [a])
    _sell(auth_client, [a, b])

    items = _frequent(auth_client)

    # b: 3 sales, c: 3 sales (tie -> by article), a: 2 sales.
    assert [i["article"] for i in items] == ["B2", "C3", "A1"]


def test_frequent_item_has_stock(auth_client: TestClient, db_session: Session) -> None:
    oc = _stocked(db_session, "OC90")
    _sell(auth_client, [oc])

    [item] = _frequent(auth_client)

    assert item["id"] == oc.id
    assert item["stock"] == 99
    assert item["name"] == "Товар OC90"
    assert item["sale_price"] == 100_00


def test_frequent_limit(auth_client: TestClient, db_session: Session) -> None:
    products = [_stocked(db_session, f"P{n:02}") for n in range(8)]
    _sell(auth_client, products)

    assert len(_frequent(auth_client)) == 6
    assert [i["article"] for i in _frequent(auth_client, limit=2)] == ["P00", "P01"]
    assert len(_frequent(auth_client, limit=20)) == 8


def test_frequent_skips_archived(auth_client: TestClient, db_session: Session) -> None:
    kept = _stocked(db_session, "KEPT")
    archived = _stocked(db_session, "GONE")
    _sell(auth_client, [kept, archived])
    _sell(auth_client, [archived])
    archived.is_archived = True
    db_session.flush()

    assert [i["article"] for i in _frequent(auth_client)] == ["KEPT"]


def test_frequent_skips_cancelled_sales(auth_client: TestClient, db_session: Session) -> None:
    a = _stocked(db_session, "A1")
    b = _stocked(db_session, "B2")
    _sell(auth_client, [b])
    for _ in range(2):
        _cancel(auth_client, _sell(auth_client, [a])["id"])

    assert [i["article"] for i in _frequent(auth_client)] == ["B2"]


def test_frequent_counts_only_last_30_days(auth_client: TestClient, db_session: Session) -> None:
    old = _stocked(db_session, "OLD")
    new = _stocked(db_session, "NEW")
    now = datetime.now(UTC)
    for _ in range(3):
        _sell(auth_client, [old], sold_at=now - timedelta(days=31))
    _sell(auth_client, [old], sold_at=now - timedelta(days=29))
    _sell(auth_client, [new])
    _sell(auth_client, [new])

    assert [i["article"] for i in _frequent(auth_client)] == ["NEW", "OLD"]


def test_recent_by_last_posted_sale(auth_client: TestClient, db_session: Session) -> None:
    oc = _stocked(db_session, "OC90")
    first = create_customer(db_session, "Бірінші")
    second = create_customer(db_session, "Екінші")
    now = datetime.now(UTC)
    _sell(auth_client, [oc], first, sold_at=now - timedelta(days=5))
    _sell(auth_client, [oc], second, sold_at=now - timedelta(days=3))
    _sell(auth_client, [oc], first, sold_at=now - timedelta(days=1))
    # Sales without a customer are ignored.
    _sell(auth_client, [oc])

    items = _recent(auth_client)

    assert [i["name"] for i in items] == ["Бірінші", "Екінші"]
    assert set(items[0]) == {"id", "name", "phone", "note", "created_at"}


def test_recent_filled_with_newest_customers_without_sales(
    auth_client: TestClient, db_session: Session
) -> None:
    oc = _stocked(db_session, "OC90")
    buyer = create_customer(db_session, "Сатып алған")
    older = create_customer(db_session, "Ескі")
    newer = create_customer(db_session, "Жаңа")
    # created_at is the transaction time in tests: the newer id decides.
    assert newer.id > older.id
    _sell(auth_client, [oc], buyer)

    assert [i["name"] for i in _recent(auth_client)] == ["Сатып алған", "Жаңа", "Ескі"]
    assert [i["name"] for i in _recent(auth_client, limit=2)] == ["Сатып алған", "Жаңа"]


def test_recent_ignores_cancelled_sales(auth_client: TestClient, db_session: Session) -> None:
    oc = _stocked(db_session, "OC90")
    cancelled = create_customer(db_session, "Бас тартқан")
    posted = create_customer(db_session, "Сатып алған")
    now = datetime.now(UTC)
    _sell(auth_client, [oc], posted, sold_at=now - timedelta(days=2))
    _cancel(auth_client, _sell(auth_client, [oc], cancelled)["id"])

    # The cancelled sale does not lift its customer: it comes with the customers without sales.
    assert [i["name"] for i in _recent(auth_client)] == ["Сатып алған", "Бас тартқан"]


def test_recent_limit(auth_client: TestClient, db_session: Session) -> None:
    for n in range(8):
        create_customer(db_session, f"Покупатель {n}")

    assert len(_recent(auth_client)) == 6
    assert len(_recent(auth_client, limit=20)) == 8
    assert len(_recent(auth_client, limit=1)) == 1
