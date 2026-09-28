import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.catalog.models import Product
from app.inventory.models import StockBalance, StockMovement
from tests.factories import create_product


def _stock(db: Session, product_id: int) -> int:
    query = select(func.coalesce(func.sum(StockBalance.qty), 0)).where(
        StockBalance.product_id == product_id
    )
    return db.execute(query).scalar_one()


def _receipt(client: TestClient, product_id: int, qty: int) -> dict:
    response = client.post(
        "/api/receipts", json={"lines": [{"product_id": product_id, "qty": qty}]}
    )
    assert response.status_code == 201, response.text
    return response.json()


def _adjust(client: TestClient, product_id: int, qty: int, reason: str = "Пересчёт") -> dict:
    response = client.post(
        "/api/stock/adjustments", json={"product_id": product_id, "qty": qty, "reason": reason}
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def product(db_session: Session) -> Product:
    return create_product(db_session, article="OC-90")


def test_adjustment_plus_and_minus(
    auth_client: TestClient, db_session: Session, product: Product
) -> None:
    plus = _adjust(auth_client, product.id, 5, reason="  Нашли на складе ")

    assert plus["stock"] == 5
    movement = plus["movement"]
    assert movement["qty"] == 5
    assert movement["kind"] == "adjustment"
    assert movement["doc_type"] is None
    assert movement["doc_id"] is None
    assert movement["doc_number"] is None
    assert movement["note"] == "Нашли на складе"
    assert movement["created_by_name"] == "Тест"
    assert movement["balance_after"] == 5
    assert movement["created_at"]

    minus = _adjust(auth_client, product.id, -2)

    assert minus["stock"] == 3
    assert minus["movement"]["qty"] == -2
    assert minus["movement"]["balance_after"] == 3
    assert _stock(db_session, product.id) == 3


def test_adjustment_below_zero_rejected(
    auth_client: TestClient, db_session: Session, product: Product
) -> None:
    _adjust(auth_client, product.id, 2)

    response = auth_client.post(
        "/api/stock/adjustments", json={"product_id": product.id, "qty": -3, "reason": "Пересчёт"}
    )

    assert response.status_code == 409
    assert response.json() == {
        "detail": "Недостаточно товара. OC-90: на остатке 2, требуется 3",
        "code": "insufficient_stock",
        "params": {"items": [{"article": "OC-90", "available": 2, "requested": 3}]},
    }
    assert _stock(db_session, product.id) == 2
    count = select(func.count()).where(StockMovement.product_id == product.id)
    assert db_session.execute(count).scalar_one() == 1


@pytest.mark.parametrize(
    "fields",
    [
        {"reason": None},
        {"reason": ""},
        {"reason": "  ab  "},
        {"reason": "a" * 501},
        {"qty": 0},
        {"qty": 100_001},
        {"qty": -100_001},
        {"qty": 1.5},
        {"qty": "5"},
        {"product_id": 0},
        {"extra": 1},
    ],
)
def test_adjustment_validation(
    auth_client: TestClient, db_session: Session, product: Product, fields: dict[str, object]
) -> None:
    payload: dict[str, object] = {"product_id": product.id, "qty": 5, "reason": "Пересчёт"}
    payload.update(fields)
    payload = {k: v for k, v in payload.items() if v is not None}

    response = auth_client.post("/api/stock/adjustments", json=payload)

    assert response.status_code == 422
    assert _stock(db_session, product.id) == 0


def test_adjustment_allowed_for_archived_product(
    auth_client: TestClient, db_session: Session
) -> None:
    product = create_product(db_session, is_archived=True)
    assert _adjust(auth_client, product.id, 1)["stock"] == 1


def test_adjustment_missing_product(auth_client: TestClient) -> None:
    response = auth_client.post(
        "/api/stock/adjustments", json={"product_id": 999999999, "qty": 1, "reason": "Пересчёт"}
    )
    assert response.status_code == 404
    assert response.json() == {
        "detail": "Товар не найден",
        "code": "product_not_found",
        "params": {},
    }


def test_movement_history(auth_client: TestClient, db_session: Session, product: Product) -> None:
    other = create_product(db_session)
    first = _receipt(auth_client, product.id, 5)
    second = _receipt(auth_client, product.id, 3)
    _receipt(auth_client, other.id, 7)
    _adjust(auth_client, product.id, -1, reason="Брак")
    cancel = auth_client.post(f"/api/receipts/{second['id']}/cancel", json={"reason": "Ошибка"})
    assert cancel.status_code == 200

    body = auth_client.get(f"/api/products/{product.id}/movements").json()

    assert body["total"] == 4
    rows = [
        (m["qty"], m["kind"], m["doc_type"], m["doc_id"], m["doc_number"], m["balance_after"])
        for m in body["items"]
    ]
    assert rows == [
        (-3, "receipt_cancel", "receipt", second["id"], second["number"], 4),
        (-1, "adjustment", None, None, None, 7),
        (3, "receipt", "receipt", second["id"], second["number"], 8),
        (5, "receipt", "receipt", first["id"], first["number"], 5),
    ]
    assert [m["note"] for m in body["items"]] == ["Ошибка", "Брак", None, None]
    assert all(m["created_by_name"] == "Тест" for m in body["items"])
    ids = [m["id"] for m in body["items"]]
    assert ids == sorted(ids, reverse=True)
    assert body["items"][0]["balance_after"] == _stock(db_session, product.id)


def test_movement_history_pagination(auth_client: TestClient, product: Product) -> None:
    for qty in (1, 2, 3):
        _adjust(auth_client, product.id, qty)

    body = auth_client.get(
        f"/api/products/{product.id}/movements", params={"limit": 1, "offset": 1}
    ).json()

    assert body["total"] == 3
    assert [(m["qty"], m["balance_after"]) for m in body["items"]] == [(2, 3)]


def test_movement_history_empty(auth_client: TestClient, product: Product) -> None:
    body = auth_client.get(f"/api/products/{product.id}/movements").json()
    assert body == {"items": [], "total": 0}


def test_movement_history_missing_product(auth_client: TestClient) -> None:
    response = auth_client.get("/api/products/999999999/movements")
    assert response.status_code == 404
    assert response.json() == {
        "detail": "Товар не найден",
        "code": "product_not_found",
        "params": {},
    }
