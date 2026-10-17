import uuid

import pytest
from sqlalchemy import select

from app.auth.models import User
from app.inventory.models import StockBalance, StockMovement
from app.inventory.service import MovementIn, post_movements
from app.sales.models import SaleLine
from app.schema_types import MAX_MONEY
from tests.factories import create_customer, create_product, create_user


def post(client, path, **body):
    response = client.post(path, json={"request_id": str(uuid.uuid4()), **body})
    assert response.status_code == 201, response.text
    return response.json()


def test_documents_keep_product_customer_and_requisites(auth_client, db_session):
    product = create_product(db_session, article="OLD", name="Old product", sale_price=1000)
    customer = create_customer(db_session, name="Old customer", phone="111")
    old_settings = {
        "seller_name": "Old seller",
        "seller_iin_bin": "123456789012",
        "responsible_person": "Old responsible",
        "released_by_name": "Old released",
        "chief_accountant": "Old accountant",
    }
    assert auth_client.put("/api/settings", json=old_settings).status_code == 200
    receipt = post(
        auth_client,
        "/api/receipts",
        lines=[
            {"product_id": product.id, "qty": 10, "unit_cost": 500},
        ],
    )
    sale_payload = {
        "request_id": str(uuid.uuid4()),
        "customer_id": customer.id,
        "lines": [{"product_id": product.id, "qty": 3, "unit_price": 800}],
    }
    sale_response = auth_client.post("/api/sales", json=sale_payload)
    assert sale_response.status_code == 201, sale_response.text
    sale = sale_response.json()

    assert (
        auth_client.patch(
            f"/api/products/{product.id}",
            json={
                "article": "NEW",
                "name": "New product",
                "unit": "компл",
                "sale_price": 1500,
            },
        ).status_code
        == 200
    )
    assert (
        auth_client.patch(
            f"/api/customers/{customer.id}",
            json={
                "name": "New customer",
                "phone": "222",
            },
        ).status_code
        == 200
    )
    new_settings = {**old_settings, "seller_name": "New seller", "released_by_name": "New released"}
    assert auth_client.put("/api/settings", json=new_settings).status_code == 200

    # A return created after the rename still belongs to the original product snapshot.
    returned = post(
        auth_client,
        "/api/returns",
        sale_id=sale["id"],
        lines=[
            {
                "sale_line_id": sale["lines"][0]["id"],
                "qty": 1,
                "condition": "good",
            }
        ],
    )
    for path, document in [("sales", sale), ("receipts", receipt), ("returns", returned)]:
        result = auth_client.get(f"/api/{path}/{document['id']}").json()
        assert {k: result["lines"][0][k] for k in ("article", "name", "unit")} == {
            "article": "OLD",
            "name": "Old product",
            "unit": "шт",
        }
        if path != "receipts":
            assert result["customer"] == {"id": customer.id, "name": "Old customer", "phone": "111"}
        if path == "sales":
            assert result["requisites"] == old_settings
            assert result["lines"][0]["list_price"] == 1000

    replay = auth_client.post("/api/sales", json=sale_payload)
    assert replay.status_code == 200
    assert replay.json()["requisites"] == old_settings
    assert replay.json()["customer"]["name"] == "Old customer"
    new_sale = post(
        auth_client,
        "/api/sales",
        customer_id=customer.id,
        lines=[
            {"product_id": product.id, "qty": 1, "unit_price": 1000},
        ],
    )
    new_receipt = post(
        auth_client,
        "/api/receipts",
        lines=[
            {"product_id": product.id, "qty": 1, "unit_cost": 600},
        ],
    )
    for document in (new_sale, new_receipt):
        assert document["lines"][0]["name"] == "New product"
        assert document["lines"][0]["unit"] == "компл"
        assert document["lines"][0]["article"] == "NEW"
    assert new_sale["requisites"] == new_settings
    assert new_sale["customer"]["name"] == "New customer"
    assert new_sale["customer"]["phone"] == "222"
    assert new_sale["lines"][0]["list_price"] == 1500
    listed = auth_client.get("/api/sales").json()["items"]
    assert (
        next(item for item in listed if item["id"] == sale["id"])["customer_name"] == "Old customer"
    )
    assert auth_client.get("/api/returns").json()["items"][0]["customer"] == returned["customer"]


def test_released_by_fallback_is_frozen(auth_client, db_session):
    user = db_session.scalar(select(User).where(User.username.like("user%")))
    product = create_product(db_session)
    post_movements(db_session, [MovementIn(product.id, 1, "receipt")], user.id)
    sale = post(
        auth_client,
        "/api/sales",
        lines=[
            {
                "product_id": product.id,
                "qty": 1,
                "unit_price": 0,
            }
        ],
    )
    original = user.full_name
    user.full_name = "Changed author"
    db_session.commit()
    assert sale["requisites"]["released_by_name"] == original
    assert (
        auth_client.get(f"/api/sales/{sale['id']}").json()["requisites"]["released_by_name"]
        == original
    )


@pytest.mark.parametrize("price,discount", [(800, 600), (1000, 0), (1200, 0), (0, 3000)])
def test_sale_discount(auth_client, db_session, price, discount):
    product = create_product(db_session, sale_price=1000)
    user = create_user(db_session)
    post_movements(db_session, [MovementIn(product.id, 3, "receipt")], user.id)
    sale = post(
        auth_client,
        "/api/sales",
        lines=[
            {
                "product_id": product.id,
                "qty": 3,
                "unit_price": price,
            }
        ],
    )
    assert sale["lines"][0]["discount"] == discount
    assert sale["discount_total"] == discount
    line = db_session.get(SaleLine, sale["lines"][0]["id"])
    # Reproduce a legacy line whose original list price was never known.
    line.list_price = None
    db_session.commit()
    legacy = auth_client.get(f"/api/sales/{sale['id']}").json()
    assert legacy["lines"][0]["discount"] is None
    assert legacy["discount_total"] is None


def test_mixed_unknown_discount_and_discount_limit(auth_client, db_session):
    user = create_user(db_session)
    products = [create_product(db_session, sale_price=100_000_000_000) for _ in range(2)]
    post_movements(db_session, [MovementIn(p.id, 100_000, "receipt") for p in products], user.id)
    sale = post(
        auth_client,
        "/api/sales",
        lines=[{"product_id": p.id, "qty": 5000, "unit_price": 0} for p in products],
    )
    assert sale["discount_total"] == MAX_MONEY
    db_session.get(SaleLine, sale["lines"][0]["id"]).list_price = None
    db_session.commit()
    mixed = auth_client.get(f"/api/sales/{sale['id']}").json()
    assert mixed["discount_total"] is None
    assert mixed["lines"][1]["discount"] == MAX_MONEY // 2
    response = auth_client.post(
        "/api/sales",
        json={
            "request_id": str(uuid.uuid4()),
            "lines": [
                {"product_id": products[0].id, "qty": 100_000, "unit_price": 0},
            ],
        },
    )
    assert response.status_code == 422
    assert response.json()["code"] == "amount_too_large"


@pytest.mark.parametrize("cost", [0, 12345])
def test_adjustment_cost_and_replay(auth_client, db_session, cost):
    product = create_product(db_session)
    body = {
        "request_id": str(uuid.uuid4()),
        "product_id": product.id,
        "qty": 2,
        "reason": "Пересчёт",
    }
    missing = auth_client.post("/api/stock/adjustments", json=body)
    assert missing.status_code == 422
    assert missing.json()["code"] == "adjustment_cost_required"
    assert (
        db_session.scalar(select(StockBalance).where(StockBalance.product_id == product.id)) is None
    )
    body["unit_cost"] = cost
    first = auth_client.post("/api/stock/adjustments", json=body)
    assert first.status_code == 201, first.text
    assert auth_client.get(f"/api/products/{product.id}").json()["avg_cost"] == cost
    movement = db_session.get(StockMovement, first.json()["movement"]["id"])
    assert movement.unit_cost == movement.requested_unit_cost == cost
    assert auth_client.post("/api/stock/adjustments", json=body).json() == first.json()
    for changed in (None, cost + 1):
        replay = auth_client.post("/api/stock/adjustments", json={**body, "unit_cost": changed})
        assert replay.status_code == 409
    excess = auth_client.post(
        "/api/stock/adjustments", json={**body, "request_id": str(uuid.uuid4())}
    )
    assert excess.status_code == 422
    assert excess.json()["code"] == "adjustment_cost_not_allowed"
    no_cost = {**body, "request_id": str(uuid.uuid4())}
    no_cost.pop("unit_cost")
    assert auth_client.post("/api/stock/adjustments", json=no_cost).status_code == 201
    assert auth_client.post("/api/stock/adjustments", json=no_cost).status_code == 200


def test_negative_adjustment_rejects_cost_even_when_unknown(auth_client, db_session):
    product = create_product(db_session)
    user = create_user(db_session)
    post_movements(db_session, [MovementIn(product.id, 2, "receipt")], user.id)
    response = auth_client.post(
        "/api/stock/adjustments",
        json={
            "request_id": str(uuid.uuid4()),
            "product_id": product.id,
            "qty": -1,
            "unit_cost": 0,
            "reason": "Пересчёт",
        },
    )
    assert response.status_code == 422
    assert response.json()["code"] == "adjustment_cost_not_allowed"


@pytest.mark.parametrize("cost", [-1, True, 1.5, "100", 100_000_000_001])
def test_adjustment_cost_validation(auth_client, db_session, cost):
    product = create_product(db_session)
    response = auth_client.post(
        "/api/stock/adjustments",
        json={
            "request_id": str(uuid.uuid4()),
            "product_id": product.id,
            "qty": 1,
            "unit_cost": cost,
            "reason": "Пересчёт",
        },
    )
    assert response.status_code == 422
    assert response.json()["errors"][0]["field"] == "unit_cost"
