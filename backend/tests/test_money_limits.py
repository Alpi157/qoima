import uuid

import pytest
from sqlalchemy import func, select

from app.catalog.schemas import MAX_SALE_PRICE
from app.inventory.models import StockBalance, StockMovement
from app.inventory.service import MovementIn, post_movements
from app.numbering import DocumentCounter
from app.receipts.models import Receipt
from app.sales.models import Sale
from app.schema_types import MAX_MONEY
from tests.factories import create_customer, create_product, create_user


@pytest.mark.parametrize("kind", ["sale", "receipt"])
@pytest.mark.parametrize("case", ["line_over", "total_over", "boundary"])
def test_document_money_limits(auth_client, db_session, kind, case):
    user = create_user(db_session)
    products = [create_product(db_session) for _ in range(2)]
    post_movements(db_session, [MovementIn(p.id, 100_000, "adjustment") for p in products], user.id)
    db_session.commit()
    count_before = db_session.scalar(select(func.count()).select_from(StockMovement))
    number_before = db_session.scalar(
        select(DocumentCounter.last_number).where(DocumentCounter.doc_type == kind)
    )
    qty = 100_000 if case == "line_over" else 10_000
    price_key = "unit_price" if kind == "sale" else "unit_cost"
    lines = [
        {"product_id": p.id, "qty": qty, price_key: MAX_SALE_PRICE}
        for p in products[: 2 if case == "total_over" else 1]
    ]
    response = auth_client.post(
        "/api/sales" if kind == "sale" else "/api/receipts",
        json={"request_id": str(uuid.uuid4()), "lines": lines},
    )
    if case == "boundary":
        assert response.status_code == 201, response.text
        assert response.json()["total" if kind == "sale" else "total_cost"] == MAX_MONEY
    else:
        assert response.status_code == 422
        assert response.json() == {
            "detail": "Сумма слишком большая",
            "code": "amount_too_large",
            "params": {},
        }
        assert db_session.scalar(select(func.count()).select_from(StockMovement)) == count_before
        assert db_session.scalar(select(func.sum(StockBalance.qty))) == 200_000
        assert db_session.scalar(select(func.count()).select_from(Sale)) == 0
        assert db_session.scalar(select(func.count()).select_from(Receipt)) == 0
        assert (
            db_session.scalar(
                select(DocumentCounter.last_number).where(DocumentCounter.doc_type == kind)
            )
            == number_before
        )


@pytest.mark.parametrize(
    "kind",
    [
        "payment",
        "positive_adjustment",
        "negative_adjustment",
        "expected_credit",
        "expected_refund",
        "sale_payment",
    ],
)
def test_request_amount_above_limit(auth_client, db_session, kind):
    customer = create_customer(db_session)
    body = {"request_id": str(uuid.uuid4()), "customer_id": customer.id}
    if kind == "payment":
        path = "/api/payments"
        body["amount"] = MAX_MONEY + 1
    elif kind.endswith("adjustment"):
        path = "/api/debt-adjustments"
        body.update(
            amount=(MAX_MONEY + 1) * (-1 if kind.startswith("negative") else 1), reason="Opening"
        )
    elif kind.startswith("expected"):
        path = "/api/returns"
        body.pop("customer_id")
        body.update(
            sale_id=1,
            lines=[{"sale_line_id": 1, "qty": 1, "condition": "good"}],
            expected_debt_credit=MAX_MONEY + int(kind == "expected_credit"),
            expected_refund_amount=MAX_MONEY + int(kind == "expected_refund"),
        )
    else:
        path = "/api/sales"
        body.update(paid_amount=MAX_MONEY + 1, lines=[{"product_id": 1, "qty": 1, "unit_price": 0}])
    response = auth_client.post(path, json=body)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert response.json()["errors"][0]["type"] in ("less_than_equal", "greater_than_equal")


@pytest.mark.parametrize("kind", ["payment", "adjustment"])
def test_amount_exact_boundary(auth_client, db_session, kind):
    customer = create_customer(db_session)
    opening = {
        "request_id": str(uuid.uuid4()),
        "customer_id": customer.id,
        "amount": MAX_MONEY,
        "reason": "Opening",
    }
    assert auth_client.post("/api/debt-adjustments", json=opening).status_code == 201
    body = {"request_id": str(uuid.uuid4()), "customer_id": customer.id}
    if kind == "payment":
        path = "/api/payments"
        body["amount"] = MAX_MONEY
    else:
        path = "/api/debt-adjustments"
        body.update(amount=-MAX_MONEY, reason="Correction")
    response = auth_client.post(path, json=body)
    assert response.status_code == 201, response.text
    assert abs(response.json()["amount"]) == MAX_MONEY
