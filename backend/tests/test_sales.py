import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.catalog.models import Product
from app.inventory.models import StockBalance, StockMovement
from app.inventory.service import MovementIn, post_movements
from app.sales import service as sales_service
from app.sales.models import Sale
from tests.factories import create_customer, create_product, create_user


def _stock(db: Session, product_id: int) -> int:
    query = select(func.coalesce(func.sum(StockBalance.qty), 0)).where(
        StockBalance.product_id == product_id
    )
    return db.execute(query).scalar_one()


def _sale_count(db: Session) -> int:
    return db.execute(select(func.count()).select_from(Sale)).scalar_one()


def _receive(db: Session, product: Product, qty: int) -> None:
    user = create_user(db)
    post_movements(db, [MovementIn(product.id, qty, "receipt")], user.id)


def _payload(lines: list[dict[str, object]], **fields: object) -> dict[str, object]:
    return {"request_id": str(uuid.uuid4()), "lines": lines, **fields}


def _post(client: TestClient, lines: list[dict[str, object]], **fields: object) -> dict:
    response = client.post("/api/sales", json=_payload(lines, **fields))
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
    oc = create_product(db_session, article="OC-90", name="Фильтр масляный", sale_price=250_000)
    bosch = create_product(db_session, article="0986.452.041", name="Фильтр Bosch", sale_price=0)
    _receive(db_session, oc, 10)
    _receive(db_session, bosch, 5)
    return oc, bosch


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/sales"),
        ("get", "/api/sales/1"),
        ("post", "/api/sales"),
        ("post", "/api/sales/1/cancel"),
    ],
)
def test_sale_endpoints_require_login(client: TestClient, method: str, path: str) -> None:
    response = client.request(method, path, json={})
    assert response.status_code == 401


def test_post_sale_decreases_stock(
    auth_client: TestClient, db_session: Session, products: tuple[Product, Product]
) -> None:
    oc, bosch = products
    customer = create_customer(db_session, name="Ерлан", phone="+7 701 000 00 00")
    request_id = str(uuid.uuid4())

    response = auth_client.post(
        "/api/sales",
        json={
            "request_id": request_id,
            "customer_id": customer.id,
            "note": "  Самовывоз ",
            "lines": [
                {"product_id": oc.id, "qty": 3},
                {"product_id": bosch.id, "qty": 2, "unit_price": 99_950},
            ],
        },
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert _stock(db_session, oc.id) == 7
    assert _stock(db_session, bosch.id) == 3
    assert body["request_id"] == request_id
    assert body["customer"] == {"id": customer.id, "name": "Ерлан", "phone": "+7 701 000 00 00"}
    assert body["note"] == "Самовывоз"
    assert body["status"] == "posted"
    assert body["cancelled_at"] is None
    assert body["cancel_reason"] is None
    assert body["created_by_name"] == "Тест"
    assert body["lines"] == [
        {
            "product_id": oc.id,
            "article": "OC-90",
            "name": "Фильтр масляный",
            "unit": "шт",
            "qty": 3,
            "unit_price": 250_000,
            "line_total": 750_000,
        },
        {
            "product_id": bosch.id,
            "article": "0986.452.041",
            "name": "Фильтр Bosch",
            "unit": "шт",
            "qty": 2,
            "unit_price": 99_950,
            "line_total": 199_900,
        },
    ]
    assert body["total"] == 949_900
    assert auth_client.get(f"/api/sales/{body['id']}").json() == body


def test_sale_movements_reference_the_document(
    auth_client: TestClient, db_session: Session, products: tuple[Product, Product]
) -> None:
    oc, _ = products
    sale = _post(auth_client, [{"product_id": oc.id, "qty": 4}])

    movement = db_session.execute(
        select(StockMovement).where(StockMovement.doc_id == sale["id"])
    ).scalar_one()
    assert (movement.product_id, movement.qty, movement.kind, movement.doc_type) == (
        oc.id,
        -4,
        "sale",
        "sale",
    )


def test_sale_without_customer(auth_client: TestClient, products: tuple[Product, Product]) -> None:
    oc, _ = products
    body = _post(auth_client, [{"product_id": oc.id, "qty": 1}])
    assert body["customer"] is None
    assert body["note"] is None


def test_sale_number_grows(auth_client: TestClient, products: tuple[Product, Product]) -> None:
    oc, _ = products
    first = _post(auth_client, [{"product_id": oc.id, "qty": 1}])
    second = _post(auth_client, [{"product_id": oc.id, "qty": 1}])
    assert second["number"] > first["number"]


def test_price_required_when_product_has_none(
    auth_client: TestClient, db_session: Session, products: tuple[Product, Product]
) -> None:
    oc, bosch = products
    response = auth_client.post(
        "/api/sales",
        json=_payload([{"product_id": oc.id, "qty": 1}, {"product_id": bosch.id, "qty": 1}]),
    )
    assert response.status_code == 422
    assert response.json() == {
        "detail": "Укажите цену для товара 0986.452.041",
        "code": "invalid_document_lines",
    }
    assert _sale_count(db_session) == 0
    assert _stock(db_session, oc.id) == 10


def test_explicit_zero_price_allowed(
    auth_client: TestClient, products: tuple[Product, Product]
) -> None:
    oc, bosch = products
    body = _post(
        auth_client,
        [
            {"product_id": oc.id, "qty": 1, "unit_price": 0},
            {"product_id": bosch.id, "qty": 2, "unit_price": 0},
        ],
    )
    assert [line["unit_price"] for line in body["lines"]] == [0, 0]
    assert body["total"] == 0


def test_sold_at_in_the_past_is_kept(
    auth_client: TestClient, products: tuple[Product, Product]
) -> None:
    oc, _ = products
    body = _post(
        auth_client, [{"product_id": oc.id, "qty": 1}], sold_at="2026-01-05T10:00:00+05:00"
    )
    assert datetime.fromisoformat(body["sold_at"]) == datetime(2026, 1, 5, 5, 0, tzinfo=UTC)


def test_sold_at_in_the_future_rejected(
    auth_client: TestClient, db_session: Session, products: tuple[Product, Product]
) -> None:
    oc, _ = products
    future = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    response = auth_client.post(
        "/api/sales", json=_payload([{"product_id": oc.id, "qty": 1}], sold_at=future)
    )
    assert response.status_code == 422
    assert response.json()["errors"] == [
        {"field": "sold_at", "message": "Дата продажи не может быть в будущем"}
    ]
    assert _stock(db_session, oc.id) == 10


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"lines": [{"product_id": 1, "qty": 1}]},
        {"request_id": "not-a-uuid", "lines": [{"product_id": 1, "qty": 1}]},
        _payload([]),
        _payload([{"product_id": 1, "qty": 1}] * 201),
        _payload([{"product_id": 1, "qty": 0}]),
        _payload([{"product_id": 1, "qty": 100_001}]),
        _payload([{"product_id": 1, "qty": "1"}]),
        _payload([{"product_id": 1, "qty": 1, "unit_price": -1}]),
        _payload([{"product_id": 1, "qty": 1, "unit_price": 100_000_000_001}]),
        _payload([{"product_id": 1, "qty": 1, "unit_price": 10.5}]),
        _payload([{"product_id": 1, "qty": 1, "extra": 1}]),
        _payload([{"product_id": 1, "qty": 1}], total=100),
        _payload([{"product_id": 1, "qty": 1}], note="a" * 1001),
        _payload([{"product_id": 1, "qty": 1}], customer_id=0),
        _payload([{"product_id": 1, "qty": 1}], sold_at="2026-01-05T10:00:00"),
    ],
)
def test_post_sale_validation(auth_client: TestClient, payload: dict[str, object]) -> None:
    assert auth_client.post("/api/sales", json=payload).status_code == 422


def test_missing_customer_rejected(
    auth_client: TestClient, db_session: Session, products: tuple[Product, Product]
) -> None:
    oc, _ = products
    response = auth_client.post(
        "/api/sales", json=_payload([{"product_id": oc.id, "qty": 1}], customer_id=999999999)
    )
    assert response.status_code == 422
    assert response.json() == {
        "detail": "Покупатель не найден",
        "code": "document_customer_not_found",
    }
    assert _stock(db_session, oc.id) == 10


def test_missing_product_rejected(
    auth_client: TestClient, products: tuple[Product, Product]
) -> None:
    oc, _ = products
    response = auth_client.post(
        "/api/sales",
        json=_payload([{"product_id": oc.id, "qty": 1}, {"product_id": 999999999, "qty": 1}]),
    )
    assert response.status_code == 422
    assert response.json() == {
        "detail": "Товар не найден: 999999999",
        "code": "invalid_document_lines",
    }


def test_duplicate_product_rejected(
    auth_client: TestClient, db_session: Session, products: tuple[Product, Product]
) -> None:
    oc, _ = products
    response = auth_client.post(
        "/api/sales",
        json=_payload([{"product_id": oc.id, "qty": 1}, {"product_id": oc.id, "qty": 2}]),
    )
    assert response.status_code == 422
    assert response.json() == {
        "detail": "Товар OC-90 указан в продаже дважды",
        "code": "invalid_document_lines",
    }
    assert _stock(db_session, oc.id) == 10


def test_archived_product_rejected(auth_client: TestClient, db_session: Session) -> None:
    product = create_product(db_session, article="ARH-1", sale_price=100, is_archived=True)
    _receive(db_session, product, 3)
    response = auth_client.post("/api/sales", json=_payload([{"product_id": product.id, "qty": 1}]))
    assert response.status_code == 409
    assert response.json() == {"detail": "Товар ARH-1 в архиве", "code": "product_archived"}
    assert _stock(db_session, product.id) == 3


def test_insufficient_stock_creates_nothing(
    auth_client: TestClient, db_session: Session, products: tuple[Product, Product]
) -> None:
    oc, bosch = products
    response = auth_client.post(
        "/api/sales",
        json=_payload(
            [
                {"product_id": oc.id, "qty": 2},
                {"product_id": bosch.id, "qty": 6, "unit_price": 100},
            ]
        ),
    )
    assert response.status_code == 409
    assert response.json() == {
        "detail": "Недостаточно товара. 0986.452.041: на остатке 5, требуется 6",
        "code": "insufficient_stock",
    }
    assert _sale_count(db_session) == 0
    assert _stock(db_session, oc.id) == 10
    assert _stock(db_session, bosch.id) == 5


def _lines(spec: list[tuple[str, int, int | None]], ids: dict[str, int]) -> list[dict]:
    """Lines from (product key, qty, unit_price or None to omit it)."""
    return [
        {"product_id": ids[key], "qty": qty} | ({"unit_price": price} if price is not None else {})
        for key, qty, price in spec
    ]


@pytest.mark.parametrize(
    "retry",
    [
        # Same lines, same prices; OC-90 again at the product's price.
        [("oc", 2, None), ("bosch", 1, 500)],
        # Lines in another order.
        [("bosch", 1, 500), ("oc", 2, None)],
        # The product's price passed explicitly: the resolved content is the same.
        [("oc", 2, 250_000), ("bosch", 1, 500)],
    ],
)
def test_same_request_returns_same_sale(
    auth_client: TestClient,
    db_session: Session,
    products: tuple[Product, Product],
    retry: list[tuple[str, int, int | None]],
) -> None:
    oc, bosch = products
    ids = {"oc": oc.id, "bosch": bosch.id}
    customer = create_customer(db_session)
    payload = _payload(_lines([("oc", 2, None), ("bosch", 1, 500)], ids), customer_id=customer.id)
    first = auth_client.post("/api/sales", json=payload)
    payload["lines"] = _lines(retry, ids)
    second = auth_client.post("/api/sales", json=payload)

    assert first.status_code == 201
    assert second.status_code == 200, second.text
    assert second.json() == first.json()
    assert _sale_count(db_session) == 1
    assert _stock(db_session, oc.id) == 8
    assert _stock(db_session, bosch.id) == 4


@pytest.mark.parametrize(
    ("retry", "other_customer"),
    [
        ([("oc", 3, None)], False),
        ([("oc", 2, None), ("bosch", 1, 100)], False),
        # Another price than the first sale, which went at the product's price.
        ([("oc", 2, 249_999)], False),
        # No price and the product has none: a conflict, not "Укажите цену".
        ([("bosch", 2, None)], False),
        ([("oc", 2, None)], True),
    ],
)
def test_same_request_other_content_rejected(
    auth_client: TestClient,
    db_session: Session,
    products: tuple[Product, Product],
    retry: list[tuple[str, int, int | None]],
    other_customer: bool,
) -> None:
    oc, bosch = products
    ids = {"oc": oc.id, "bosch": bosch.id}
    payload = _payload(_lines([("oc", 2, None)], ids))
    assert auth_client.post("/api/sales", json=payload).status_code == 201

    payload["lines"] = _lines(retry, ids)
    if other_customer:
        payload["customer_id"] = create_customer(db_session).id
    response = auth_client.post("/api/sales", json=payload)

    assert response.status_code == 409
    assert response.json() == {
        "detail": "Этот запрос уже использован для другой продажи",
        "code": "sale_request_conflict",
    }
    assert _sale_count(db_session) == 1
    assert _stock(db_session, oc.id) == 8


def test_same_request_with_explicit_price_then_without_it_rejected(
    auth_client: TestClient, db_session: Session, products: tuple[Product, Product]
) -> None:
    oc, _ = products
    ids = {"oc": oc.id}
    payload = _payload(_lines([("oc", 2, 200_000)], ids))
    assert auth_client.post("/api/sales", json=payload).status_code == 201

    # Without unit_price the product's 250000 would apply: not the same sale.
    payload["lines"] = _lines([("oc", 2, None)], ids)
    response = auth_client.post("/api/sales", json=payload)

    assert response.status_code == 409
    assert _sale_count(db_session) == 1


def test_concurrent_same_request_returns_existing_sale(
    auth_client: TestClient,
    db_session: Session,
    products: tuple[Product, Product],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    oc, _ = products
    payload = _payload([{"product_id": oc.id, "qty": 2}])
    first = auth_client.post("/api/sales", json=payload)
    assert first.status_code == 201

    # Simulate the race: the first lookup misses the sale committed by the "other" request,
    # so the insert hits uq_sales_request_id.
    real_find = sales_service.find_sale_by_request_id
    calls = []

    def find_missing_once(db: Session, request_id: uuid.UUID) -> Sale | None:
        calls.append(request_id)
        return None if len(calls) == 1 else real_find(db, request_id)

    monkeypatch.setattr(sales_service, "find_sale_by_request_id", find_missing_once)
    second = auth_client.post("/api/sales", json=payload)

    assert len(calls) == 2
    assert second.status_code == 200, second.text
    assert second.json() == first.json()
    assert _sale_count(db_session) == 1
    assert _stock(db_session, oc.id) == 8


def test_cancel_sale_returns_stock(
    auth_client: TestClient, db_session: Session, products: tuple[Product, Product]
) -> None:
    oc, bosch = products
    sale = _post(
        auth_client,
        [{"product_id": oc.id, "qty": 3}, {"product_id": bosch.id, "qty": 5, "unit_price": 10}],
    )
    assert (_stock(db_session, oc.id), _stock(db_session, bosch.id)) == (7, 0)

    response = auth_client.post(f"/api/sales/{sale['id']}/cancel", json={"reason": " Возврат "})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "cancelled"
    assert body["cancelled_at"] is not None
    assert body["cancel_reason"] == "Возврат"
    assert body["total"] == sale["total"]
    assert (_stock(db_session, oc.id), _stock(db_session, bosch.id)) == (10, 5)
    movements = db_session.execute(
        select(StockMovement.product_id, StockMovement.qty, StockMovement.note).where(
            StockMovement.kind == "sale_cancel", StockMovement.doc_id == sale["id"]
        )
    ).all()
    assert sorted(movements) == sorted([(oc.id, 3, "Возврат"), (bosch.id, 5, "Возврат")])


def test_cancelled_by_name_is_the_user_who_cancelled(
    auth_client: TestClient, db_session: Session, products: tuple[Product, Product]
) -> None:
    oc, _ = products
    sale = _post(auth_client, [{"product_id": oc.id, "qty": 3}])
    assert sale["cancelled_by_name"] is None

    _login_as(auth_client, db_session, "Второй")
    response = auth_client.post(f"/api/sales/{sale['id']}/cancel", json={"reason": "Ошибка"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["created_by_name"], body["cancelled_by_name"]) == ("Тест", "Второй")
    fetched = auth_client.get(f"/api/sales/{sale['id']}").json()
    assert fetched["cancelled_by_name"] == "Второй"


def test_cancel_twice_rejected(
    auth_client: TestClient, db_session: Session, products: tuple[Product, Product]
) -> None:
    oc, _ = products
    sale = _post(auth_client, [{"product_id": oc.id, "qty": 3}])
    url = f"/api/sales/{sale['id']}/cancel"
    assert auth_client.post(url, json={"reason": "Возврат"}).status_code == 200

    response = auth_client.post(url, json={"reason": "Ещё раз"})

    assert response.status_code == 409
    assert response.json() == {"detail": "Продажа уже отменена", "code": "sale_already_cancelled"}
    assert _stock(db_session, oc.id) == 10


@pytest.mark.parametrize("payload", [{}, {"reason": "ab"}, {"reason": "a" * 501}])
def test_cancel_requires_reason(
    auth_client: TestClient, products: tuple[Product, Product], payload: dict[str, object]
) -> None:
    oc, _ = products
    sale = _post(auth_client, [{"product_id": oc.id, "qty": 1}])
    assert auth_client.post(f"/api/sales/{sale['id']}/cancel", json=payload).status_code == 422


def test_missing_sale(auth_client: TestClient) -> None:
    for response in (
        auth_client.get("/api/sales/999999999"),
        auth_client.post("/api/sales/999999999/cancel", json={"reason": "Ошибка"}),
    ):
        assert response.status_code == 404
        assert response.json() == {"detail": "Продажа не найдена", "code": "sale_not_found"}


def test_list_sales(
    auth_client: TestClient, db_session: Session, products: tuple[Product, Product]
) -> None:
    oc, bosch = products
    customer = create_customer(db_session, name="Ерлан")
    old = _post(
        auth_client,
        [{"product_id": oc.id, "qty": 2}, {"product_id": bosch.id, "qty": 3, "unit_price": 100}],
        customer_id=customer.id,
        sold_at="2026-01-05T10:00:00+05:00",
    )
    middle = _post(auth_client, [{"product_id": oc.id, "qty": 1}])
    new = _post(auth_client, [{"product_id": oc.id, "qty": 1}])
    auth_client.post(f"/api/sales/{new['id']}/cancel", json={"reason": "Ошибка ввода"})

    body = auth_client.get("/api/sales").json()

    assert body["total"] == 3
    assert body["sum_posted"] == old["total"] + middle["total"]
    assert [s["id"] for s in body["items"]] == [new["id"], middle["id"], old["id"]]
    assert body["items"][2] == {
        "id": old["id"],
        "number": old["number"],
        "sold_at": old["sold_at"],
        "customer_name": "Ерлан",
        "status": "posted",
        "lines_count": 2,
        "total_qty": 5,
        "total": 500_300,
    }
    assert body["items"][0]["customer_name"] is None

    # sum_posted covers the whole filter, not only the page.
    page = auth_client.get("/api/sales", params={"limit": 1, "offset": 1}).json()
    assert page["total"] == 3
    assert [s["id"] for s in page["items"]] == [middle["id"]]
    assert page["sum_posted"] == old["total"] + middle["total"]

    by_customer = auth_client.get("/api/sales", params={"customer_id": customer.id}).json()
    assert [s["id"] for s in by_customer["items"]] == [old["id"]]
    assert by_customer["sum_posted"] == old["total"]

    posted = auth_client.get("/api/sales", params={"status": "posted"}).json()
    assert [s["id"] for s in posted["items"]] == [middle["id"], old["id"]]
    cancelled = auth_client.get("/api/sales", params={"status": "cancelled"}).json()
    assert [s["id"] for s in cancelled["items"]] == [new["id"]]
    assert cancelled["sum_posted"] == 0


def test_list_sales_empty(auth_client: TestClient) -> None:
    assert auth_client.get("/api/sales").json() == {"items": [], "total": 0, "sum_posted": 0}


def test_same_sold_at_sorted_by_id(
    auth_client: TestClient, products: tuple[Product, Product]
) -> None:
    oc, _ = products
    at = "2026-02-01T12:00:00+05:00"
    ids = [_post(auth_client, [{"product_id": oc.id, "qty": 1}], sold_at=at)["id"] for _ in "ab"]
    body = auth_client.get("/api/sales").json()
    assert [s["id"] for s in body["items"]] == ids[::-1]


@pytest.mark.parametrize(
    ("sold_at", "day", "found"),
    [
        # 23:59 in Almaty is 18:59 UTC of the same day.
        ("2026-03-10T18:59:00+00:00", "2026-03-10", True),
        ("2026-03-10T18:59:00+00:00", "2026-03-11", False),
        # 00:00 in Almaty is 19:00 UTC of the previous day.
        ("2026-03-10T19:00:00+00:00", "2026-03-11", True),
        ("2026-03-10T19:00:00+00:00", "2026-03-10", False),
    ],
)
def test_date_filter_uses_almaty_days(
    auth_client: TestClient,
    products: tuple[Product, Product],
    sold_at: str,
    day: str,
    found: bool,
) -> None:
    oc, _ = products
    sale = _post(auth_client, [{"product_id": oc.id, "qty": 1}], sold_at=sold_at)

    body = auth_client.get("/api/sales", params={"date_from": day, "date_to": day}).json()

    assert ([s["id"] for s in body["items"]] == [sale["id"]]) is found
    assert body["sum_posted"] == (sale["total"] if found else 0)


def test_product_history_shows_sale_number(
    auth_client: TestClient, products: tuple[Product, Product]
) -> None:
    oc, _ = products
    sale = _post(auth_client, [{"product_id": oc.id, "qty": 4}])
    auth_client.post(f"/api/sales/{sale['id']}/cancel", json={"reason": "Возврат"})

    body = auth_client.get(f"/api/products/{oc.id}/movements").json()

    assert [
        (m["kind"], m["qty"], m["doc_type"], m["doc_id"], m["doc_number"], m["balance_after"])
        for m in body["items"][:2]
    ] == [
        ("sale_cancel", 4, "sale", sale["id"], sale["number"], 10),
        ("sale", -4, "sale", sale["id"], sale["number"], 6),
    ]
