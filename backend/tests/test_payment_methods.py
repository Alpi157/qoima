import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.inventory.service import MovementIn, post_movements
from tests.factories import create_customer, create_product, create_user


@pytest.fixture
def payment_case(db_session):
    user = create_user(db_session)
    product = create_product(db_session, sale_price=100)
    customer = create_customer(db_session)
    post_movements(db_session, [MovementIn(product.id, 10, "receipt", unit_cost=50)], user.id)
    return product.id, customer.id, user.id


def _sale(client, case, **values):
    product, customer, _ = case
    return client.post(
        "/api/sales",
        json={
            "request_id": str(uuid.uuid4()),
            "customer_id": customer,
            "lines": [{"product_id": product, "qty": 1}],
            **values,
        },
    )


def test_sale_methods_default_zero_and_ledger(auth_client, payment_case):
    full = _sale(auth_client, payment_case).json()
    zero = _sale(auth_client, payment_case, paid_amount=0).json()
    card = _sale(auth_client, payment_case, paid_amount=50, payment_method="card").json()
    expected = {full["id"]: "cash", zero["id"]: None, card["id"]: "card"}
    assert {row["id"]: row["payment_method"] for row in [full, zero, card]} == expected
    listed = auth_client.get("/api/sales").json()["items"]
    assert {row["id"]: row["payment_method"] for row in listed} == expected
    response = _sale(auth_client, payment_case, paid_amount=0, payment_method="cash")
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert (
        response.json()["errors"][0]["message"]
        == "Способ оплаты можно указать только при оплате больше нуля"
    )
    ledger = auth_client.get(f"/api/customers/{payment_case[1]}/ledger").json()["items"]
    assert {row["id"]: row["payment_method"] for row in ledger} == expected


def test_zero_total_with_method_rejected(auth_client, payment_case):
    lines = [{"product_id": payment_case[0], "qty": 1, "unit_price": 0}]
    response = _sale(auth_client, payment_case, lines=lines, payment_method="card")
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    valid = _sale(auth_client, payment_case, lines=lines)
    assert valid.status_code == 201
    assert valid.json()["payment_method"] is None


@pytest.mark.parametrize("method", ["cash", "card"])
def test_zero_payment_method_without_customer_is_validation_error(
    auth_client, payment_case, method
):
    response = _sale(
        auth_client, payment_case, customer_id=None, paid_amount=0, payment_method=method
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert response.json()["errors"][0]["type"] == "payment_method_without_payment"
    assert auth_client.get("/api/sales").json()["total"] == 0
    assert auth_client.get(f"/api/products/{payment_case[0]}").json()["stock"] == 10


def test_sale_idempotency_uses_effective_method(auth_client, payment_case):
    request_id = str(uuid.uuid4())
    original = _sale(auth_client, payment_case, request_id=request_id)
    assert original.status_code == 201
    retry = _sale(auth_client, payment_case, request_id=request_id, payment_method="cash")
    assert retry.status_code == 200
    assert retry.json() == original.json()
    conflict = _sale(auth_client, payment_case, request_id=request_id, payment_method="card")
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "sale_request_conflict"
    invalid = _sale(
        auth_client, payment_case, request_id=request_id, paid_amount=0, payment_method="cash"
    )
    assert invalid.status_code == 422
    assert invalid.json()["code"] == "validation_error"


def test_payment_method_default_idempotency_and_ledger(auth_client, payment_case):
    _sale(auth_client, payment_case, paid_amount=0)
    body = {"request_id": str(uuid.uuid4()), "customer_id": payment_case[1], "amount": 30}
    payment = auth_client.post("/api/payments", json=body)
    assert payment.status_code == 201
    assert payment.json()["payment_method"] == "cash"
    assert (
        auth_client.post("/api/payments", json={**body, "payment_method": "cash"}).status_code
        == 200
    )
    conflict = auth_client.post("/api/payments", json={**body, "payment_method": "card"})
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "payment_request_conflict"
    card = auth_client.post(
        "/api/payments", json={**body, "request_id": str(uuid.uuid4()), "payment_method": "card"}
    )
    assert card.status_code == 201
    assert card.json()["payment_method"] == "card"
    ledger = auth_client.get(f"/api/customers/{payment_case[1]}/ledger").json()["items"]
    assert {row["payment_method"] for row in ledger if row["kind"] == "payment"} == {"cash", "card"}


@pytest.mark.parametrize(
    ("paid", "method", "constraint"),
    [(1, None, "consistent"), (0, "cash", "consistent"), (1, "other", "valid")],
)
def test_sales_payment_checks_direct_insert(db_session, payment_case, paid, method, constraint):
    with (
        pytest.raises(IntegrityError, match=f"ck_sales_payment_method_{constraint}"),
        db_session.begin_nested(),
    ):
        db_session.execute(
            text(
                "INSERT INTO sales (number,request_id,customer_id,total,paid_at_sale,"
                "payment_method,created_by) VALUES (900, :r, :c, 100, :p, :m, :u)"
            ),
            {"r": uuid.uuid4(), "c": payment_case[1], "p": paid, "m": method, "u": payment_case[2]},
        )


@pytest.mark.parametrize("method", [None, "other"])
def test_payment_checks_direct_insert(db_session, payment_case, method):
    with pytest.raises(IntegrityError), db_session.begin_nested():
        db_session.execute(
            text(
                "INSERT INTO customer_payments (number,request_id,customer_id,amount,"
                "payment_method,created_by) VALUES (900,:r,:c,1,:m,:u)"
            ),
            {"r": uuid.uuid4(), "c": payment_case[1], "m": method, "u": payment_case[2]},
        )


def test_receipt_price_required_and_zero_accepted(auth_client, payment_case):
    body = {"lines": [{"product_id": payment_case[0], "qty": 1}]}
    for value in ["missing", None]:
        if value is None:
            body["lines"][0]["unit_cost"] = None
        response = auth_client.post("/api/receipts", json=body)
        assert response.status_code == 422
        assert response.json()["code"] == "validation_error"
    body["lines"][0]["unit_cost"] = 0
    response = auth_client.post("/api/receipts", json=body)
    assert response.status_code == 201
    assert response.json()["lines"][0]["unit_cost"] == 0
