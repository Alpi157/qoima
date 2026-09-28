import pytest
from fastapi.testclient import TestClient

EMPTY = {
    "seller_name": "",
    "seller_iin_bin": "",
    "responsible_person": "",
    "released_by_name": "",
    "chief_accountant": "",
}
FILLED = {
    "seller_name": "3А Аuto Parts.KZ",
    "seller_iin_bin": "900101300123",
    "responsible_person": "Кәкеш Арман",
    "released_by_name": "Кәкеш А.",
    "chief_accountant": "Қамтамасыз етілмейді",
}
IIN_BIN_MESSAGE = "ИИН/БИН должен состоять из 12 цифр"


def _fields(body: dict[str, object]) -> dict[str, object]:
    return {key: value for key, value in body.items() if key != "updated_at"}


def _field_errors(response_json: dict[str, object]) -> dict[str, str]:
    errors = response_json["errors"]
    assert isinstance(errors, list)
    return {e["field"]: e["message"] for e in errors}


@pytest.mark.parametrize("method", ["get", "put"])
def test_settings_require_login(client: TestClient, method: str) -> None:
    response = client.request(method, "/api/settings", json=FILLED)
    assert response.status_code == 401
    assert response.json() == {
        "detail": "Требуется вход",
        "code": "not_authenticated",
        "params": {},
    }


def test_default_settings_are_empty(auth_client: TestClient) -> None:
    response = auth_client.get("/api/settings")

    assert response.status_code == 200
    body = response.json()
    assert _fields(body) == EMPTY
    assert body["updated_at"]


def test_save_settings(auth_client: TestClient) -> None:
    response = auth_client.put("/api/settings", json=FILLED)

    assert response.status_code == 200
    assert _fields(response.json()) == FILLED
    assert _fields(auth_client.get("/api/settings").json()) == FILLED


def test_save_trims_strings_and_allows_clearing(auth_client: TestClient) -> None:
    auth_client.put("/api/settings", json=FILLED)
    padded = {key: f"  {value}  " for key, value in FILLED.items()}

    response = auth_client.put("/api/settings", json=padded)
    assert _fields(response.json()) == FILLED

    response = auth_client.put("/api/settings", json={**EMPTY, "seller_name": "   "})
    assert response.status_code == 200
    assert _fields(response.json()) == EMPTY


@pytest.mark.parametrize(
    "iin_bin", ["90010130012", "9001013001234", "90010130012A", "9001 0130 0123"]
)
def test_invalid_iin_bin_rejected(auth_client: TestClient, iin_bin: str) -> None:
    response = auth_client.put("/api/settings", json={**FILLED, "seller_iin_bin": iin_bin})

    assert response.status_code == 422
    assert _field_errors(response.json()) == {"seller_iin_bin": IIN_BIN_MESSAGE}
    assert _fields(auth_client.get("/api/settings").json()) == EMPTY


def test_iin_bin_with_surrounding_spaces_accepted(auth_client: TestClient) -> None:
    response = auth_client.put("/api/settings", json={**FILLED, "seller_iin_bin": " 900101300123 "})
    assert response.status_code == 200
    assert response.json()["seller_iin_bin"] == "900101300123"


@pytest.mark.parametrize(
    ("field", "limit"),
    [
        ("seller_name", 255),
        ("responsible_person", 255),
        ("released_by_name", 255),
        ("chief_accountant", 255),
    ],
)
def test_length_limits(auth_client: TestClient, field: str, limit: int) -> None:
    assert auth_client.put("/api/settings", json={**FILLED, field: "x" * limit}).status_code == 200

    response = auth_client.put("/api/settings", json={**FILLED, field: "x" * (limit + 1)})
    assert response.status_code == 422
    assert _field_errors(response.json()) == {field: f"Максимальная длина: {limit}"}


def test_extra_and_missing_fields_rejected(auth_client: TestClient) -> None:
    body = {key: value for key, value in FILLED.items() if key != "chief_accountant"}
    response = auth_client.put("/api/settings", json={**body, "seller_address": "Астана"})

    assert response.status_code == 422
    assert _field_errors(response.json()) == {
        "chief_accountant": "Обязательное поле",
        "seller_address": "Лишнее поле",
    }


def test_put_updates_updated_at(auth_client: TestClient) -> None:
    before = auth_client.get("/api/settings").json()["updated_at"]
    after = auth_client.put("/api/settings", json=FILLED).json()["updated_at"]
    # now() is the transaction start, and the test shares one transaction: it can only not go back.
    assert after >= before
