import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.factories import create_customer


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/customers"),
        ("get", "/api/customers/1"),
        ("post", "/api/customers"),
        ("patch", "/api/customers/1"),
    ],
)
def test_customers_require_login(client: TestClient, method: str, path: str) -> None:
    response = client.request(method, path, json={})
    assert response.status_code == 401


def test_create_customer(auth_client: TestClient) -> None:
    response = auth_client.post(
        "/api/customers",
        json={"name": "  Ержан Сапаров ", "phone": " +7 701 123 45 67 ", "note": ""},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Ержан Сапаров"
    assert body["phone"] == "+7 701 123 45 67"
    assert body["note"] is None
    assert body["created_at"]


def test_same_names_allowed(auth_client: TestClient) -> None:
    for _ in range(2):
        assert auth_client.post("/api/customers", json={"name": "Ержан"}).status_code == 201


@pytest.mark.parametrize(
    "payload",
    [{}, {"name": ""}, {"name": "  "}, {"name": "a" * 256}, {"name": "A", "phone": "1" * 33}],
)
def test_create_customer_validation(auth_client: TestClient, payload: dict[str, object]) -> None:
    assert auth_client.post("/api/customers", json=payload).status_code == 422


def test_get_and_update_customer(auth_client: TestClient) -> None:
    customer_id = auth_client.post(
        "/api/customers", json={"name": "Ержан", "phone": "87011234567"}
    ).json()["id"]

    response = auth_client.patch(
        f"/api/customers/{customer_id}", json={"note": "Оптовик", "phone": None}
    )

    assert response.status_code == 200
    body = auth_client.get(f"/api/customers/{customer_id}").json()
    assert body["name"] == "Ержан"
    assert body["phone"] is None
    assert body["note"] == "Оптовик"


def test_update_customer_rejects_null_name(auth_client: TestClient) -> None:
    customer_id = auth_client.post("/api/customers", json={"name": "Ержан"}).json()["id"]
    response = auth_client.patch(f"/api/customers/{customer_id}", json={"name": None})
    assert response.status_code == 422


@pytest.mark.parametrize("method", ["get", "patch"])
def test_missing_customer(auth_client: TestClient, method: str) -> None:
    response = auth_client.request(method, "/api/customers/999999999", json={"name": "X"})
    assert response.status_code == 404
    assert response.json() == {
        "detail": "Покупатель не найден",
        "code": "customer_not_found",
        "params": {},
    }


@pytest.fixture
def customers(db_session: Session) -> None:
    create_customer(db_session, name="Ержан Сапаров", phone="+7 701 123 45 67")
    create_customer(db_session, name="Айгуль", phone="87775550011")
    create_customer(db_session, name="СТО Мотор", phone=None)


def _names(client: TestClient, **params: object) -> list[str]:
    response = client.get("/api/customers", params=params)
    assert response.status_code == 200
    return [c["name"] for c in response.json()["items"]]


@pytest.mark.usefixtures("customers")
def test_list_customers_sorted_by_name(auth_client: TestClient) -> None:
    body = auth_client.get("/api/customers").json()
    assert [c["name"] for c in body["items"]] == ["Айгуль", "Ержан Сапаров", "СТО Мотор"]
    assert body["total"] == 3


@pytest.mark.usefixtures("customers")
@pytest.mark.parametrize(
    ("q", "expected"),
    [
        ("сапар", ["Ержан Сапаров"]),
        ("МОТОР", ["СТО Мотор"]),
        ("555", ["Айгуль"]),
        ("701 123", ["Ержан Сапаров"]),
        ("%", []),
        ("_", []),
    ],
)
def test_search_customers(auth_client: TestClient, q: str, expected: list[str]) -> None:
    assert _names(auth_client, q=q) == expected


@pytest.mark.parametrize(
    "stored", ["87011234567", "+7 701 123 45 67", "8 (701) 123-45-67", "7011234567"]
)
@pytest.mark.parametrize(
    "q", ["87011234567", "+7 701 123 45 67", "77011234567", "8-701-123-45-67", "701123", "4567"]
)
def test_search_customers_by_phone_digits(
    auth_client: TestClient, db_session: Session, stored: str, q: str
) -> None:
    create_customer(db_session, name="Ержан", phone=stored)
    create_customer(db_session, name="Другой", phone="87771234000")

    assert _names(auth_client, q=q) == ["Ержан"]


@pytest.mark.parametrize("q", ["87011234568", "97011234567", "8701123456789"])
def test_phone_digits_must_match(auth_client: TestClient, db_session: Session, q: str) -> None:
    create_customer(db_session, name="Ержан", phone="+7 701 123 45 67")
    assert _names(auth_client, q=q) == []


def test_leading_digit_kept_for_short_query(auth_client: TestClient, db_session: Session) -> None:
    create_customer(db_session, name="Ержан", phone="+7 701 123 45 67")
    create_customer(db_session, name="Айгуль", phone="87775550011")

    assert _names(auth_client, q="8777") == ["Айгуль"]
    assert _names(auth_client, q="+7701") == ["Ержан"]
