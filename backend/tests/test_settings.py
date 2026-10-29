import pytest
from fastapi.testclient import TestClient

EMPTY = {
    "card_commission_percent": "0",
    "tax_percent": "0",
    "is_vat_payer": False,
    "rate_warning_percent": 10,
    "seller_name": "",
    "seller_iin_bin": "",
    "responsible_person": "",
    "released_by_name": "",
    "chief_accountant": "",
}
FILLED = {
    "card_commission_percent": "0",
    "tax_percent": "0",
    "is_vat_payer": False,
    "rate_warning_percent": 10,
    "seller_name": "3А Аuto Parts.KZ",
    "seller_iin_bin": "900101300123",
    "responsible_person": "Кәкеш Арман",
    "released_by_name": "Кәкеш А.",
    "chief_accountant": "Қамтамасыз етілмейді",
}
IIN_BIN_MESSAGE = "ИИН/БИН должен состоять из 12 цифр"


ATTENTION_DEFAULTS = {
    "opening_balance_date": None,
    "attention_markup_drop_points": 10,
    "attention_debt_days": 30,
    "attention_frozen_days": 90,
    "attention_runway_days": 30,
    "attention_discount_percent": 10,
    "attention_loss_percent": 2,
}
EMPTY.update(ATTENTION_DEFAULTS)
FILLED.update(ATTENTION_DEFAULTS)


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
    padded = {
        key: f"  {value}  " if isinstance(value, str) else value for key, value in FILLED.items()
    }

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


def test_receipt_settings_and_legacy_five_field_put(auth_client):
    body = {key: value for key, value in FILLED.items() if isinstance(value, str)}
    saved = auth_client.put(
        "/api/settings",
        json={
            **body,
            "is_vat_payer": True,
            "rate_warning_percent": 25,
        },
    )
    assert saved.status_code == 200
    assert saved.json()["is_vat_payer"] is True
    assert saved.json()["rate_warning_percent"] == 25
    legacy = auth_client.put("/api/settings", json=body)
    assert legacy.status_code == 200
    assert legacy.json()["is_vat_payer"] is True
    assert legacy.json()["rate_warning_percent"] == 25
    assert auth_client.get("/api/settings").json() == legacy.json()


@pytest.mark.parametrize("value", [0, 101, -1, None, True, "10", 1.5])
def test_receipt_threshold_rejects_invalid_values(auth_client, value):
    response = auth_client.put("/api/settings", json={**FILLED, "rate_warning_percent": value})
    assert response.status_code == 422


@pytest.mark.parametrize("value", [1, 100])
def test_receipt_threshold_accepts_boundaries(auth_client, value):
    response = auth_client.put("/api/settings", json={**FILLED, "rate_warning_percent": value})
    assert response.status_code == 200 and response.json()["rate_warning_percent"] == value


def test_vat_null_rejected(auth_client):
    assert (
        auth_client.put("/api/settings", json={**FILLED, "is_vat_payer": None}).status_code == 422
    )


@pytest.mark.parametrize("field", ["card_commission_percent", "tax_percent"])
@pytest.mark.parametrize(
    "value,expected", [("0.95", "0.95"), ("1", "1"), ("100", "100"), ("1.50", "1.5"), ("0", "0")]
)
def test_profit_percent_round_trip(auth_client, field, value, expected):
    response = auth_client.put("/api/settings", json={**FILLED, field: value})
    assert response.status_code == 200
    assert response.json()[field] == expected
    omitted = {
        key: val
        for key, val in FILLED.items()
        if key not in ("tax_percent", "card_commission_percent")
    }
    assert auth_client.put("/api/settings", json=omitted).json()[field] == expected


@pytest.mark.parametrize("field", ["card_commission_percent", "tax_percent"])
@pytest.mark.parametrize("value", ["100.01", "1.234", "-1", "abc", None, 1, "1e1", "", "1,5"])
def test_profit_percent_invalid(auth_client, field, value):
    response = auth_client.put("/api/settings", json={**FILLED, field: value})
    assert response.status_code == 422
    assert response.json()["errors"][0]["type"] == "percent_invalid"
