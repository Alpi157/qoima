from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.catalog.models import Product
from app.inventory.models import StockBalance, StockMovement
from app.inventory.service import MovementIn, post_movements
from tests.factories import create_product, create_user


def _stock(db: Session, product_id: int) -> int:
    query = select(func.coalesce(func.sum(StockBalance.qty), 0)).where(
        StockBalance.product_id == product_id
    )
    return db.execute(query).scalar_one()


def _movement_count(db: Session, product_id: int) -> int:
    query = select(func.count()).where(StockMovement.product_id == product_id)
    return db.execute(query).scalar_one()


def _post(client: TestClient, lines: list[dict[str, object]], **fields: object) -> dict:
    response = client.post("/api/receipts", json={"lines": lines, **fields})
    assert response.status_code == 201, response.text
    return response.json()


def _login_as(client: TestClient, db: Session, full_name: str) -> None:
    """Replaces the client's session with a new user named full_name."""
    user = create_user(db, full_name=full_name, password="other-password")
    response = client.post(
        "/api/auth/login", json={"username": user.username, "password": "other-password"}
    )
    assert response.status_code == 200


@pytest.fixture
def products(db_session: Session) -> tuple[Product, Product]:
    return (
        create_product(db_session, article="OC-90", name="Фильтр масляный"),
        create_product(db_session, article="0986.452.041", name="Фильтр Bosch"),
    )


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/receipts"),
        ("get", "/api/receipts/1"),
        ("post", "/api/receipts"),
        ("post", "/api/receipts/1/cancel"),
        ("post", "/api/stock/adjustments"),
        ("get", "/api/products/1/movements"),
    ],
)
def test_new_endpoints_require_login(client: TestClient, method: str, path: str) -> None:
    response = client.request(method, path, json={})
    assert response.status_code == 401


def test_post_receipt_increases_stock(
    auth_client: TestClient, db_session: Session, products: tuple[Product, Product]
) -> None:
    oc, bosch = products

    body = _post(
        auth_client,
        [
            {"product_id": oc.id, "qty": 10, "unit_cost": 150_000},
            {"product_id": bosch.id, "qty": 3},
        ],
        supplier="  Начальные остатки ",
        note="",
    )

    assert _stock(db_session, oc.id) == 10
    assert _stock(db_session, bosch.id) == 3
    assert body["supplier"] == "Начальные остатки"
    assert body["note"] is None
    assert body["status"] == "posted"
    assert body["cancelled_at"] is None
    assert body["created_by_name"] == "Тест"
    assert body["lines"] == [
        {
            "product_id": oc.id,
            "article": "OC-90",
            "name": "Фильтр масляный",
            "qty": 10,
            "unit_cost": 150_000,
        },
        {
            "product_id": bosch.id,
            "article": "0986.452.041",
            "name": "Фильтр Bosch",
            "qty": 3,
            "unit_cost": None,
        },
    ]
    assert body["total_qty"] == 13
    assert body["total_cost"] == 1_500_000
    assert auth_client.get(f"/api/receipts/{body['id']}").json() == body


def test_receipt_movements_reference_the_document(
    auth_client: TestClient, db_session: Session, products: tuple[Product, Product]
) -> None:
    oc, _ = products
    body = _post(auth_client, [{"product_id": oc.id, "qty": 2}])

    movement = db_session.execute(
        select(StockMovement).where(StockMovement.product_id == oc.id)
    ).scalar_one()
    assert (movement.kind, movement.doc_type, movement.doc_id, movement.qty) == (
        "receipt",
        "receipt",
        body["id"],
        2,
    )


def test_receipt_number_grows(auth_client: TestClient, products: tuple[Product, Product]) -> None:
    oc, _ = products
    first = _post(auth_client, [{"product_id": oc.id, "qty": 1}])
    second = _post(auth_client, [{"product_id": oc.id, "qty": 1}])
    assert second["number"] > first["number"]


def test_total_cost_is_null_without_prices(
    auth_client: TestClient, products: tuple[Product, Product]
) -> None:
    oc, bosch = products
    body = _post(auth_client, [{"product_id": oc.id, "qty": 2}, {"product_id": bosch.id, "qty": 5}])
    assert body["total_qty"] == 7
    assert body["total_cost"] is None


def test_zero_unit_cost_counts_as_price(
    auth_client: TestClient, products: tuple[Product, Product]
) -> None:
    oc, _ = products
    body = _post(auth_client, [{"product_id": oc.id, "qty": 2, "unit_cost": 0}])
    assert body["total_cost"] == 0


def test_received_at_in_the_past_is_kept(
    auth_client: TestClient, products: tuple[Product, Product]
) -> None:
    oc, _ = products
    body = _post(
        auth_client, [{"product_id": oc.id, "qty": 1}], received_at="2026-01-05T10:00:00+05:00"
    )
    assert datetime.fromisoformat(body["received_at"]) == datetime(2026, 1, 5, 5, tzinfo=UTC)


def test_received_at_in_the_future_rejected(
    auth_client: TestClient, db_session: Session, products: tuple[Product, Product]
) -> None:
    oc, _ = products
    future = (datetime.now(UTC) + timedelta(hours=1)).isoformat()

    response = auth_client.post(
        "/api/receipts", json={"lines": [{"product_id": oc.id, "qty": 1}], "received_at": future}
    )

    assert response.status_code == 422
    assert _stock(db_session, oc.id) == 0


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"lines": []},
        {"lines": [{"product_id": 1, "qty": 1}] * 201},
        {"lines": [{"product_id": 1, "qty": 0}]},
        {"lines": [{"product_id": 1, "qty": 100_001}]},
        {"lines": [{"product_id": 1, "qty": 1.5}]},
        {"lines": [{"product_id": 1, "qty": "1"}]},
        {"lines": [{"product_id": 1, "qty": 1, "unit_cost": -1}]},
        {"lines": [{"product_id": 1, "qty": 1, "unit_cost": 10.5}]},
        {"lines": [{"product_id": 1, "qty": 1, "extra": 1}]},
        {"lines": [{"product_id": 1, "qty": 1}], "status": "cancelled"},
        {"lines": [{"product_id": 1, "qty": 1}], "supplier": "a" * 256},
        {"lines": [{"product_id": 1, "qty": 1}], "note": "a" * 1001},
        {"lines": [{"product_id": 1, "qty": 1}], "received_at": "2026-01-05T10:00:00"},
    ],
)
def test_post_receipt_validation(auth_client: TestClient, payload: dict[str, object]) -> None:
    assert auth_client.post("/api/receipts", json=payload).status_code == 422


def test_duplicate_product_rejected(
    auth_client: TestClient, db_session: Session, products: tuple[Product, Product]
) -> None:
    oc, _ = products
    response = auth_client.post(
        "/api/receipts",
        json={"lines": [{"product_id": oc.id, "qty": 1}, {"product_id": oc.id, "qty": 2}]},
    )
    assert response.status_code == 422
    assert response.json() == {
        "detail": "Товар OC-90 указан в приходе дважды",
        "code": "invalid_document_lines",
    }
    assert _stock(db_session, oc.id) == 0


def test_missing_product_rejected(
    auth_client: TestClient, products: tuple[Product, Product]
) -> None:
    oc, _ = products
    response = auth_client.post(
        "/api/receipts",
        json={"lines": [{"product_id": oc.id, "qty": 1}, {"product_id": 999999999, "qty": 1}]},
    )
    assert response.status_code == 422
    assert response.json() == {
        "detail": "Товар не найден: 999999999",
        "code": "invalid_document_lines",
    }


def test_archived_product_rejected(auth_client: TestClient, db_session: Session) -> None:
    product = create_product(db_session, article="ARH-1", is_archived=True)
    response = auth_client.post(
        "/api/receipts", json={"lines": [{"product_id": product.id, "qty": 1}]}
    )
    assert response.status_code == 409
    assert response.json() == {"detail": "Товар ARH-1 в архиве", "code": "product_archived"}
    assert _stock(db_session, product.id) == 0


def test_missing_receipt(auth_client: TestClient) -> None:
    for response in (
        auth_client.get("/api/receipts/999999999"),
        auth_client.post("/api/receipts/999999999/cancel", json={"reason": "Ошибка"}),
    ):
        assert response.status_code == 404
        assert response.json() == {"detail": "Приход не найден", "code": "receipt_not_found"}


def test_list_receipts(auth_client: TestClient, products: tuple[Product, Product]) -> None:
    oc, bosch = products
    old = _post(
        auth_client,
        [{"product_id": oc.id, "qty": 2, "unit_cost": 100}, {"product_id": bosch.id, "qty": 3}],
        supplier="Поставщик",
        received_at="2026-01-05T10:00:00+05:00",
    )
    new = _post(auth_client, [{"product_id": oc.id, "qty": 1}])
    auth_client.post(f"/api/receipts/{new['id']}/cancel", json={"reason": "Ошибка ввода"})

    body = auth_client.get("/api/receipts").json()

    assert body["total"] == 2
    assert [r["id"] for r in body["items"]] == [new["id"], old["id"]]
    assert body["items"][1] == {
        "id": old["id"],
        "number": old["number"],
        "received_at": old["received_at"],
        "supplier": "Поставщик",
        "status": "posted",
        "lines_count": 2,
        "total_qty": 5,
        "total_cost": 200,
    }
    assert body["items"][0]["total_cost"] is None

    posted = auth_client.get("/api/receipts", params={"status": "posted"}).json()
    assert [r["id"] for r in posted["items"]] == [old["id"]]
    cancelled = auth_client.get("/api/receipts", params={"status": "cancelled"}).json()
    assert [r["id"] for r in cancelled["items"]] == [new["id"]]

    page = auth_client.get("/api/receipts", params={"limit": 1, "offset": 1}).json()
    assert page["total"] == 2
    assert [r["id"] for r in page["items"]] == [old["id"]]


def test_same_received_at_sorted_by_id(
    auth_client: TestClient, products: tuple[Product, Product]
) -> None:
    oc, _ = products
    at = "2026-02-01T12:00:00+05:00"
    ids = [
        _post(auth_client, [{"product_id": oc.id, "qty": 1}], received_at=at)["id"] for _ in "ab"
    ]
    body = auth_client.get("/api/receipts").json()
    assert [r["id"] for r in body["items"]] == ids[::-1]


@pytest.mark.parametrize(
    ("params", "found"),
    [
        ({"date_from": "2026-03-10", "date_to": "2026-03-10"}, True),
        ({"date_from": "2026-03-10"}, True),
        ({"date_to": "2026-03-10"}, True),
        ({"date_from": "2026-03-11", "date_to": "2026-03-11"}, False),
        ({"date_from": "2026-03-09", "date_to": "2026-03-09"}, False),
        ({"date_from": "2026-03-11"}, False),
        ({"date_to": "2026-03-09"}, False),
    ],
)
def test_date_filter_uses_almaty_days(
    auth_client: TestClient,
    products: tuple[Product, Product],
    params: dict[str, str],
    found: bool,
) -> None:
    oc, _ = products
    # 23:30 in Almaty is 18:30 UTC of the same day.
    receipt = _post(
        auth_client, [{"product_id": oc.id, "qty": 1}], received_at="2026-03-10T23:30:00+05:00"
    )

    body = auth_client.get("/api/receipts", params=params).json()

    assert ([r["id"] for r in body["items"]] == [receipt["id"]]) is found
    assert body["total"] == (1 if found else 0)


def test_date_filter_invalid_date(auth_client: TestClient) -> None:
    assert auth_client.get("/api/receipts", params={"date_from": "10.03.2026"}).status_code == 422


def test_cancel_receipt_returns_stock(
    auth_client: TestClient, db_session: Session, products: tuple[Product, Product]
) -> None:
    oc, bosch = products
    receipt = _post(
        auth_client, [{"product_id": oc.id, "qty": 4}, {"product_id": bosch.id, "qty": 2}]
    )

    response = auth_client.post(
        f"/api/receipts/{receipt['id']}/cancel", json={"reason": "  Ошибка ввода "}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "cancelled"
    assert body["cancelled_at"] is not None
    assert body["cancel_reason"] == "Ошибка ввода"
    assert _stock(db_session, oc.id) == 0
    assert _stock(db_session, bosch.id) == 0
    cancel_movements = db_session.execute(
        select(StockMovement.qty, StockMovement.doc_id, StockMovement.note).where(
            StockMovement.kind == "receipt_cancel", StockMovement.product_id == oc.id
        )
    ).all()
    assert cancel_movements == [(-4, receipt["id"], "Ошибка ввода")]


def test_cancelled_by_name_is_the_user_who_cancelled(
    auth_client: TestClient, db_session: Session, products: tuple[Product, Product]
) -> None:
    oc, _ = products
    receipt = _post(auth_client, [{"product_id": oc.id, "qty": 4}])
    assert receipt["cancelled_by_name"] is None

    _login_as(auth_client, db_session, "Второй")
    response = auth_client.post(f"/api/receipts/{receipt['id']}/cancel", json={"reason": "Ошибка"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["created_by_name"], body["cancelled_by_name"]) == ("Тест", "Второй")
    fetched = auth_client.get(f"/api/receipts/{receipt['id']}").json()
    assert fetched["cancelled_by_name"] == "Второй"


def test_cancel_twice_rejected(
    auth_client: TestClient, db_session: Session, products: tuple[Product, Product]
) -> None:
    oc, _ = products
    receipt = _post(auth_client, [{"product_id": oc.id, "qty": 4}])
    url = f"/api/receipts/{receipt['id']}/cancel"
    assert auth_client.post(url, json={"reason": "Ошибка"}).status_code == 200

    response = auth_client.post(url, json={"reason": "Ещё раз"})

    assert response.status_code == 409
    assert response.json() == {"detail": "Приход уже отменён", "code": "receipt_already_cancelled"}
    assert _stock(db_session, oc.id) == 0
    assert _movement_count(db_session, oc.id) == 2


def test_cancel_after_sale_rejected(
    auth_client: TestClient, db_session: Session, products: tuple[Product, Product]
) -> None:
    oc, bosch = products
    receipt = _post(
        auth_client, [{"product_id": oc.id, "qty": 5}, {"product_id": bosch.id, "qty": 2}]
    )
    seller = create_user(db_session)
    post_movements(db_session, [MovementIn(oc.id, -3, "sale")], seller.id)

    response = auth_client.post(f"/api/receipts/{receipt['id']}/cancel", json={"reason": "Ошибка"})

    assert response.status_code == 409
    assert response.json() == {
        "detail": "Нельзя отменить приход: товара на остатке меньше, чем было в приходе. "
        "Недостаточно товара. OC-90: на остатке 2, требуется 5",
        "code": "receipt_cancel_blocked",
    }
    assert _stock(db_session, oc.id) == 2
    assert _stock(db_session, bosch.id) == 2
    assert _movement_count(db_session, oc.id) == 2
    assert _movement_count(db_session, bosch.id) == 1
    body = auth_client.get(f"/api/receipts/{receipt['id']}").json()
    assert (body["status"], body["cancelled_at"], body["cancel_reason"]) == ("posted", None, None)


@pytest.mark.parametrize("payload", [{}, {"reason": ""}, {"reason": " ab "}, {"reason": "a" * 501}])
def test_cancel_requires_reason(
    auth_client: TestClient, products: tuple[Product, Product], payload: dict[str, str]
) -> None:
    oc, _ = products
    receipt = _post(auth_client, [{"product_id": oc.id, "qty": 1}])
    response = auth_client.post(f"/api/receipts/{receipt['id']}/cancel", json=payload)
    assert response.status_code == 422
