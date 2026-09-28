import pytest
from fastapi.testclient import TestClient

from app.errors import validation_field, validation_message, validation_params

HUGE_ID = 2**63


def test_validation_error_format(auth_client: TestClient) -> None:
    response = auth_client.post(
        "/api/receipts", json={"lines": [{"product_id": 1, "qty": 0}], "extra": 1}
    )

    assert response.status_code == 422
    assert response.json() == {
        "detail": "Проверьте введённые данные",
        "code": "validation_error",
        "params": {},
        "errors": [
            {
                "field": "lines.0.qty",
                "message": "Должно быть не меньше 1",
                "type": "greater_than_equal",
                "params": {"ge": 1},
            },
            {"field": "extra", "message": "Лишнее поле", "type": "extra_forbidden", "params": {}},
        ],
    }


def test_validation_error_uses_our_own_type_and_text(auth_client: TestClient) -> None:
    response = auth_client.post(
        "/api/stock/adjustments", json={"product_id": 1, "qty": 0, "reason": "Пересчёт"}
    )
    assert response.status_code == 422
    assert response.json()["errors"] == [
        {
            "field": "qty",
            "message": "Количество не может быть нулём",
            "type": "qty_zero",
            "params": {},
        }
    ]


def test_validation_error_params_of_string_length(auth_client: TestClient) -> None:
    response = auth_client.post("/api/customers", json={"name": "Покупатель", "note": "x" * 5000})
    assert response.status_code == 422
    [error] = response.json()["errors"]
    assert error["field"] == "note"
    assert error["type"] == "string_too_long"
    assert error["params"] == {"max_length": 1000}


def test_explicit_null_lists_the_fields(auth_client: TestClient) -> None:
    response = auth_client.patch("/api/products/1", json={"name": None, "unit": None})
    assert response.status_code == 422
    assert response.json()["errors"] == [
        {
            "field": "",
            "message": "Поле не может быть пустым: name, unit",
            "type": "null_not_allowed",
            "params": {"fields": ["name", "unit"]},
        }
    ]


def test_validation_error_in_query(auth_client: TestClient) -> None:
    response = auth_client.get("/api/sales", params={"limit": 500})
    assert response.status_code == 422
    assert response.json()["errors"] == [
        {
            "field": "query.limit",
            "message": "Должно быть не больше 200",
            "type": "less_than_equal",
            "params": {"le": 200},
        }
    ]


def test_app_error_format(auth_client: TestClient) -> None:
    response = auth_client.get("/api/sales/999999999")
    assert response.status_code == 404
    assert response.json() == {
        "detail": "Продажа не найдена",
        "code": "sale_not_found",
        "params": {},
    }


@pytest.mark.parametrize(
    ("error", "message"),
    [
        ({"type": "missing"}, "Обязательное поле"),
        ({"type": "extra_forbidden"}, "Лишнее поле"),
        ({"type": "string_too_short", "ctx": {"min_length": 3}}, "Минимальная длина: 3"),
        ({"type": "string_too_long", "ctx": {"max_length": 500}}, "Максимальная длина: 500"),
        ({"type": "greater_than", "ctx": {"gt": 0}}, "Должно быть больше 0"),
        ({"type": "greater_than_equal", "ctx": {"ge": 1}}, "Должно быть не меньше 1"),
        ({"type": "less_than", "ctx": {"lt": 10}}, "Должно быть меньше 10"),
        ({"type": "less_than_equal", "ctx": {"le": 200}}, "Должно быть не больше 200"),
        ({"type": "int_type"}, "Должно быть целым числом"),
        ({"type": "int_parsing"}, "Должно быть целым числом"),
        ({"type": "uuid_parsing"}, "Некорректный идентификатор (UUID)"),
        ({"type": "date_parsing"}, "Некорректная дата"),
        ({"type": "datetime_parsing"}, "Некорректные дата и время"),
        ({"type": "too_short", "ctx": {"min_length": 1}}, "Минимум элементов: 1"),
        ({"type": "too_long", "ctx": {"max_length": 200}}, "Максимум элементов: 200"),
        ({"type": "value_error", "ctx": {"error": ValueError("Своя ошибка")}}, "Своя ошибка"),
        ({"type": "literal_error"}, "Некорректное значение"),
        ({"type": "greater_than_equal"}, "Некорректное значение"),
    ],
)
def test_validation_messages(error: dict[str, object], message: str) -> None:
    assert validation_message(error) == message


@pytest.mark.parametrize(
    ("loc", "field"),
    [
        (("body", "lines", 0, "qty"), "lines.0.qty"),
        (("body",), ""),
        (("path", "sale_id"), "path.sale_id"),
        (("query", "limit"), "query.limit"),
    ],
)
def test_validation_field(loc: tuple[int | str, ...], field: str) -> None:
    assert validation_field(loc) == field


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", f"/api/products/{HUGE_ID}"),
        ("patch", f"/api/products/{HUGE_ID}"),
        ("get", f"/api/products/{HUGE_ID}/movements"),
        ("get", f"/api/customers/{HUGE_ID}"),
        ("patch", f"/api/customers/{HUGE_ID}"),
        ("get", f"/api/receipts/{HUGE_ID}"),
        ("post", f"/api/receipts/{HUGE_ID}/cancel"),
        ("get", f"/api/sales/{HUGE_ID}"),
        ("post", f"/api/sales/{HUGE_ID}/cancel"),
        ("get", f"/api/sales?customer_id={HUGE_ID}"),
    ],
)
def test_huge_id_in_path_rejected(auth_client: TestClient, method: str, path: str) -> None:
    response = auth_client.request(method, path, json={"reason": "Ошибка"})
    assert response.status_code == 422
    assert response.json()["errors"][0]["message"] == f"Должно быть не больше {HUGE_ID - 1}"


@pytest.mark.parametrize(
    ("path", "body", "field"),
    [
        ("/api/receipts", {"lines": [{"product_id": HUGE_ID, "qty": 1}]}, "lines.0.product_id"),
        (
            "/api/sales",
            {
                "request_id": "0b3f5d2e-8a3c-4c1e-9f0a-2d6b7e8f9a01",
                "lines": [{"product_id": HUGE_ID, "qty": 1}],
            },
            "lines.0.product_id",
        ),
        (
            "/api/sales",
            {
                "request_id": "0b3f5d2e-8a3c-4c1e-9f0a-2d6b7e8f9a01",
                "customer_id": HUGE_ID,
                "lines": [{"product_id": 1, "qty": 1}],
            },
            "customer_id",
        ),
        (
            "/api/stock/adjustments",
            {"product_id": HUGE_ID, "qty": 1, "reason": "Пересчёт"},
            "product_id",
        ),
    ],
)
def test_huge_id_in_body_rejected(
    auth_client: TestClient, path: str, body: dict[str, object], field: str
) -> None:
    response = auth_client.post(path, json=body)
    assert response.status_code == 422
    assert response.json()["errors"] == [
        {
            "field": field,
            "message": f"Должно быть не больше {HUGE_ID - 1}",
            "type": "less_than_equal",
            "params": {"le": HUGE_ID - 1},
        }
    ]


def test_max_bigint_id_is_valid(auth_client: TestClient) -> None:
    response = auth_client.get(f"/api/products/{HUGE_ID - 1}")
    assert response.status_code == 404


@pytest.mark.parametrize(
    ("error", "params"),
    [
        ({"type": "missing"}, {}),
        ({"type": "less_than_equal", "ctx": {"le": 200}}, {"le": 200}),
        ({"type": "string_too_short", "ctx": {"min_length": 3}}, {"min_length": 3}),
        ({"type": "value_error", "ctx": {"error": ValueError("Своя ошибка")}}, {}),
        (
            {"type": "literal_error", "ctx": {"expected": "'kk', 'ru' or 'zh'"}},
            {"expected": "'kk', 'ru' or 'zh'"},
        ),
        ({"type": "null_not_allowed", "ctx": {"fields": ["name"]}}, {"fields": ["name"]}),
    ],
)
def test_validation_params(error: dict[str, object], params: dict[str, object]) -> None:
    assert validation_params(error) == params


def test_iin_bin_error_type(auth_client: TestClient) -> None:
    payload = dict.fromkeys(
        ["seller_name", "responsible_person", "released_by_name", "chief_accountant"], ""
    )
    response = auth_client.put("/api/settings", json={**payload, "seller_iin_bin": "123"})
    assert response.status_code == 422
    [error] = response.json()["errors"]
    assert (error["field"], error["type"]) == ("seller_iin_bin", "iin_bin_format")


def test_future_date_error_type(auth_client: TestClient) -> None:
    response = auth_client.post(
        "/api/receipts",
        json={"lines": [{"product_id": 1, "qty": 1}], "received_at": "2999-01-01T00:00:00Z"},
    )
    assert response.status_code == 422
    [error] = response.json()["errors"]
    assert error == {
        "field": "received_at",
        "message": "Дата прихода не может быть в будущем",
        "type": "date_in_future",
        "params": {},
    }
