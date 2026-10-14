"""Conflicts point to the stored document, including when the retry changes its parent."""

import uuid

import pytest

from tests.factories import create_customer, create_product


@pytest.mark.parametrize(
    "kind", ["sale", "receipt", "payment", "return", "debt_adjustment", "stock_adjustment"]
)
def test_conflict_identifies_saved_document(auth_client, db_session, kind):
    product = create_product(db_session, sale_price=1000)
    customer = create_customer(db_session)

    def post(path, body):
        body["request_id"] = str(uuid.uuid4())
        response = auth_client.post(path, json=body)
        assert response.status_code == 201, response.text
        return response.json()

    receipt_body = {"lines": [{"product_id": product.id, "qty": 10, "unit_cost": 500}]}
    receipt = post("/api/receipts", receipt_body)
    sale_body = {
        "customer_id": customer.id,
        "paid_amount": 0,
        "lines": [{"product_id": product.id, "qty": 3, "unit_price": 1000}],
    }
    sale = post("/api/sales", sale_body)
    if kind == "sale":
        path, body, saved = "/api/sales", sale_body, sale
        body = {**body, "customer_id": create_customer(db_session).id}
    elif kind == "receipt":
        path, body, saved = "/api/receipts", receipt_body, receipt
        body = {**body, "supplier": "Other"}
    elif kind == "payment":
        path = "/api/payments"
        body = {"customer_id": customer.id, "amount": 100}
        saved = post(path, body)
        body = {**body, "amount": 101}
    elif kind == "return":
        path = "/api/returns"
        body = {
            "sale_id": sale["id"],
            "lines": [{"sale_line_id": sale["lines"][0]["id"], "qty": 1, "condition": "good"}],
        }
        saved = post(path, body)
        body = {**body, "note": "Other"}
    elif kind == "debt_adjustment":
        path = "/api/debt-adjustments"
        body = {"customer_id": customer.id, "amount": 100, "reason": "Opening"}
        saved = post(path, body)
        body = {**body, "reason": "Other"}
    else:
        path = "/api/stock/adjustments"
        body = {"product_id": product.id, "qty": 1, "reason": "Recount"}
        saved = post(path, body)
        body = {**body, "product_id": create_product(db_session).id}
    request_id = body["request_id"] if kind == "stock_adjustment" else saved["request_id"]
    response = auth_client.post(path, json={**body, "request_id": request_id})
    assert response.status_code == 409, response.text
    assert response.json()["code"] == f"{kind}_request_conflict"
    assert response.json()["params"] == (
        {"movement_id": saved["movement"]["id"], "product_id": product.id}
        if kind == "stock_adjustment"
        else {"id": saved["id"], "number": saved["number"]}
    )
