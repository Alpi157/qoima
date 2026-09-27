import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog import service
from app.catalog.models import Product
from app.catalog.schemas import MAX_SALE_PRICE, ProductCreate
from app.errors import DuplicateArticleError
from app.inventory.service import MovementIn, post_movements
from tests.factories import create_product, create_user


def _create(client: TestClient, **fields: object):
    payload = {"article": "OC90", "name": "Фильтр масляный", "sale_price": 350_000, **fields}
    return client.post("/api/products", json=payload)


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/products"),
        ("get", "/api/products/1"),
        ("post", "/api/products"),
        ("patch", "/api/products/1"),
    ],
)
def test_products_require_login(client: TestClient, method: str, path: str) -> None:
    response = client.request(method, path, json={})
    assert response.status_code == 401
    assert response.json() == {"detail": "Требуется вход"}


def test_create_product(auth_client: TestClient) -> None:
    response = _create(
        auth_client,
        article="  oc-90 ",
        name="  Фильтр масляный  ",
        brand=" Knecht ",
        note="  ",
    )

    assert response.status_code == 201
    body = response.json()
    assert body["article"] == "oc-90"
    assert body["article_norm"] == "OC90"
    assert body["name"] == "Фильтр масляный"
    assert body["brand"] == "Knecht"
    assert body["unit"] == "шт"
    assert body["sale_price"] == 350_000
    assert body["note"] is None
    assert body["is_archived"] is False
    assert body["stock"] == 0


def test_get_product(auth_client: TestClient) -> None:
    product_id = _create(auth_client).json()["id"]

    response = auth_client.get(f"/api/products/{product_id}")

    assert response.status_code == 200
    assert response.json()["article"] == "OC90"


def test_get_missing_product(auth_client: TestClient) -> None:
    response = auth_client.get("/api/products/999999999")
    assert response.status_code == 404
    assert response.json() == {"detail": "Товар не найден"}


def test_update_missing_product(auth_client: TestClient) -> None:
    response = auth_client.patch("/api/products/999999999", json={"name": "X"})
    assert response.status_code == 404
    assert response.json() == {"detail": "Товар не найден"}


def test_update_product(auth_client: TestClient) -> None:
    product_id = _create(auth_client, brand="Knecht").json()["id"]

    response = auth_client.patch(
        f"/api/products/{product_id}",
        json={"name": "Фильтр масла", "sale_price": 400_000, "unit": "компл", "brand": None},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Фильтр масла"
    assert body["sale_price"] == 400_000
    assert body["unit"] == "компл"
    assert body["brand"] is None
    assert body["article"] == "OC90"


def test_update_article_renormalizes(auth_client: TestClient) -> None:
    product_id = _create(auth_client).json()["id"]

    response = auth_client.patch(f"/api/products/{product_id}", json={"article": "w-712/95"})

    assert response.status_code == 200
    assert response.json()["article_norm"] == "W71295"


def test_update_article_to_own_variant_is_allowed(auth_client: TestClient) -> None:
    product_id = _create(auth_client).json()["id"]

    response = auth_client.patch(f"/api/products/{product_id}", json={"article": "oc-90"})

    assert response.status_code == 200
    assert response.json()["article"] == "oc-90"


def test_archive_and_unarchive_product(auth_client: TestClient) -> None:
    product_id = _create(auth_client).json()["id"]

    archived = auth_client.patch(f"/api/products/{product_id}", json={"is_archived": True})
    assert archived.status_code == 200
    assert archived.json()["is_archived"] is True

    restored = auth_client.patch(f"/api/products/{product_id}", json={"is_archived": False})
    assert restored.json()["is_archived"] is False


def test_no_delete_endpoint(auth_client: TestClient) -> None:
    product_id = _create(auth_client).json()["id"]
    assert auth_client.delete(f"/api/products/{product_id}").status_code == 405


@pytest.mark.parametrize(
    "fields",
    [
        {"name": ""},
        {"name": "   "},
        {"article": ""},
        {"article": "   "},
        {"sale_price": -1},
        {"sale_price": MAX_SALE_PRICE + 1},
        {"sale_price": 1.5},
        {"sale_price": "100"},
        {"article": "A" * 65},
        {"name": "Я" * 256},
        {"unit": "x" * 17},
        {"brand": "b" * 65},
        {"note": "n" * 1001},
        {"stock": 5},
    ],
)
def test_create_product_validation(auth_client: TestClient, fields: dict[str, object]) -> None:
    assert _create(auth_client, **fields).status_code == 422


def test_create_product_article_without_letters_or_digits(auth_client: TestClient) -> None:
    response = _create(auth_client, article="--/--")
    assert response.status_code == 422
    assert response.json() == {"detail": "Артикул не может быть пустым"}


def test_create_product_accepts_price_bounds(auth_client: TestClient) -> None:
    assert _create(auth_client, article="A1", sale_price=0).status_code == 201
    assert _create(auth_client, article="A2", sale_price=MAX_SALE_PRICE).status_code == 201


@pytest.mark.parametrize(
    "fields",
    [
        {"name": None},
        {"article": None},
        {"sale_price": None},
        {"unit": None},
        {"is_archived": None},
        {"name": "  "},
        {"sale_price": -5},
        {"stock": 10},
    ],
)
def test_update_product_validation(auth_client: TestClient, fields: dict[str, object]) -> None:
    product_id = _create(auth_client).json()["id"]
    assert auth_client.patch(f"/api/products/{product_id}", json=fields).status_code == 422


def test_duplicate_article_after_normalization(auth_client: TestClient) -> None:
    assert _create(auth_client, article="OC90", name="Фильтр масляный").status_code == 201

    # Cyrillic "о" and "с" plus a dash normalize to the same OC90.
    response = _create(auth_client, article="ос-90", name="Другой фильтр")

    assert response.status_code == 409
    assert response.json() == {"detail": "Товар с артикулом «OC90» уже есть: Фильтр масляный"}


def test_change_article_to_taken_one(auth_client: TestClient) -> None:
    _create(auth_client, article="OC90", name="Фильтр масляный")
    other_id = _create(auth_client, article="W712", name="Фильтр Mann").json()["id"]

    response = auth_client.patch(f"/api/products/{other_id}", json={"article": "oc 90"})

    assert response.status_code == 409
    assert response.json() == {"detail": "Товар с артикулом «OC90» уже есть: Фильтр масляный"}
    assert auth_client.get(f"/api/products/{other_id}").json()["article"] == "W712"


def test_duplicate_article_race_gives_same_error(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    create_product(db_session, article="OC90", name="Фильтр масляный")
    # Committed like a row of another transaction, so the service rollback keeps it.
    db_session.commit()
    # Simulate a concurrent insert that the pre-check did not see.
    monkeypatch.setattr(service, "_ensure_article_free", lambda *args, **kwargs: None)

    with pytest.raises(DuplicateArticleError) as exc_info:
        service.create_product(
            db_session, ProductCreate(article="oc-90", name="Другой", sale_price=0)
        )

    assert exc_info.value.message == "Товар с артикулом «OC90» уже есть: Фильтр масляный"
    names = db_session.execute(select(Product.name)).scalars().all()
    assert "Другой" not in names


def test_stock_reflects_balances(auth_client: TestClient, db_session: Session) -> None:
    product_id = _create(auth_client).json()["id"]
    user = create_user(db_session)

    post_movements(
        db_session,
        [
            MovementIn(product_id=product_id, qty=7, kind="adjustment"),
            MovementIn(product_id=product_id, qty=-2, kind="adjustment"),
        ],
        user.id,
    )

    assert auth_client.get(f"/api/products/{product_id}").json()["stock"] == 5
    items = auth_client.get("/api/products", params={"q": "OC90"}).json()["items"]
    assert items[0]["stock"] == 5
