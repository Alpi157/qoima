import uuid
from copy import deepcopy

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.inventory import service as stock_service
from app.inventory.models import StockBalance, StockMovement
from app.numbering import DocumentCounter
from app.receipts import service as receipt_service
from app.receipts.models import Receipt
from tests.factories import create_product, create_user


@pytest.fixture
def receipt_payload(db_session):
    products = [create_product(db_session) for _ in range(2)]
    return {
        "request_id": str(uuid.uuid4()),
        "supplier": "  Supplier  ",
        "note": "  Note  ",
        "received_at": "2026-01-01T10:00:00+05:00",
        "lines": [
            {"product_id": product.id, "qty": 2, "unit_cost": cost}
            for product, cost in zip(products, [100, 0], strict=True)
        ],
    }


def test_receipt_replay_normalizes_order_text_and_time(auth_client, db_session, receipt_payload):
    first = auth_client.post("/api/receipts", json=receipt_payload)
    assert first.status_code == 201
    replay = deepcopy(receipt_payload)
    replay.update(supplier="Supplier", note="Note", received_at="2026-01-01T05:00:00Z")
    replay["lines"].reverse()
    response = auth_client.post("/api/receipts", json=replay)
    assert response.status_code == 200
    assert response.json() == first.json()
    assert db_session.scalar(select(func.count()).select_from(Receipt)) == 1
    assert db_session.scalar(select(func.count()).select_from(StockMovement)) == 2
    assert db_session.scalar(select(func.sum(StockBalance.qty))) == 4
    assert (
        db_session.scalar(
            select(DocumentCounter.last_number).where(DocumentCounter.doc_type == "receipt")
        )
        == first.json()["number"]
    )


@pytest.mark.parametrize("date_value", ["omit", None])
def test_receipt_replay_without_explicit_time(auth_client, receipt_payload, date_value):
    receipt_payload.pop("received_at")
    first = auth_client.post("/api/receipts", json=receipt_payload)
    assert first.status_code == 201
    if date_value is None:
        receipt_payload["received_at"] = None
    assert auth_client.post("/api/receipts", json=receipt_payload).json() == first.json()


@pytest.mark.parametrize(
    "field", ["product_id", "qty", "unit_cost", "supplier", "note", "received_at"]
)
def test_receipt_request_conflict(auth_client, db_session, receipt_payload, field):
    first = auth_client.post("/api/receipts", json=receipt_payload)
    assert first.status_code == 201
    changed = deepcopy(receipt_payload)
    if field == "product_id":
        changed["lines"][0][field] = create_product(db_session).id
    elif field in ("qty", "unit_cost"):
        changed["lines"][0][field] += 1
    else:
        changed[field] = "2026-01-01T05:01:00Z" if field == "received_at" else "Other"
    response = auth_client.post("/api/receipts", json=changed)
    assert response.status_code == 409
    assert response.json()["code"] == "receipt_request_conflict"
    assert db_session.scalar(select(func.count()).select_from(Receipt)) == 1
    assert db_session.scalar(select(func.sum(StockBalance.qty))) == 4


def test_receipt_replay_blank_strings_and_cancelled_document(auth_client, receipt_payload):
    receipt_payload.update(supplier="  ", note="")
    first = auth_client.post("/api/receipts", json=receipt_payload).json()
    cancelled = auth_client.post(
        f"/api/receipts/{first['id']}/cancel", json={"reason": "Ошибка"}
    ).json()
    receipt_payload.update(supplier=None, note=None)
    replay = auth_client.post("/api/receipts", json=receipt_payload)
    assert replay.status_code == 200
    assert replay.json() == cancelled


@pytest.fixture
def adjustment_payload(db_session):
    return {
        "request_id": str(uuid.uuid4()),
        "product_id": create_product(db_session).id,
        "qty": 5,
        "unit_cost": 100,
        "reason": "  Пересчёт  ",
    }


def test_adjustment_replay_uses_current_stock(auth_client, db_session, adjustment_payload):
    first = auth_client.post("/api/stock/adjustments", json=adjustment_payload)
    assert first.status_code == 201
    adjustment_payload["reason"] = "Пересчёт"
    same = auth_client.post("/api/stock/adjustments", json=adjustment_payload)
    assert same.status_code == 200 and same.json() == first.json()
    other = {**adjustment_payload, "request_id": str(uuid.uuid4()), "qty": -2, "unit_cost": None}
    assert auth_client.post("/api/stock/adjustments", json=other).status_code == 201
    replay = auth_client.post("/api/stock/adjustments", json=adjustment_payload)
    assert replay.status_code == 200
    assert replay.json()["movement"] == first.json()["movement"]
    assert replay.json()["stock"] == 3
    assert db_session.scalar(select(func.count()).select_from(StockMovement)) == 2


@pytest.mark.parametrize("field", ["product_id", "qty", "reason"])
def test_adjustment_request_conflict(auth_client, db_session, adjustment_payload, field):
    assert auth_client.post("/api/stock/adjustments", json=adjustment_payload).status_code == 201
    changed = {
        **adjustment_payload,
        field: {"product_id": create_product(db_session).id, "qty": 6, "reason": "Другая причина"}[
            field
        ],
    }
    response = auth_client.post("/api/stock/adjustments", json=changed)
    assert response.status_code == 409
    assert response.json()["code"] == "stock_adjustment_request_conflict"
    assert db_session.scalar(select(func.count()).select_from(StockMovement)) == 1
    assert db_session.scalar(select(func.sum(StockBalance.qty))) == 5


@pytest.mark.parametrize("kind", ["receipt", "adjustment"])
@pytest.mark.parametrize("value", ["missing", None, "broken"])
def test_request_id_required(auth_client, receipt_payload, adjustment_payload, kind, value):
    path, payload = (
        ("/api/receipts", receipt_payload)
        if kind == "receipt"
        else ("/api/stock/adjustments", adjustment_payload)
    )
    if value == "missing":
        payload.pop("request_id")
    else:
        payload["request_id"] = value
    response = auth_client.post(path, json=payload)
    assert response.status_code == 422
    assert response.json()["errors"][0]["field"] == "request_id"


@pytest.mark.parametrize("kind", ["receipt", "adjustment"])
def test_unique_constraint_fallback_returns_existing(
    auth_client, db_session, receipt_payload, adjustment_payload, monkeypatch, kind
):
    if kind == "receipt":
        module, lookup, payload, path = (
            receipt_service,
            "_existing_receipt",
            receipt_payload,
            "/api/receipts",
        )
    else:
        # Exercise the uniqueness fallback with a cost already known before the first request.
        # A priced first adjustment legitimately becomes invalid as new input after posting.
        stock_service.post_movements(
            db_session,
            [
                stock_service.MovementIn(
                    adjustment_payload["product_id"], 1, "receipt", unit_cost=100
                )
            ],
            create_user(db_session).id,
        )
        adjustment_payload["unit_cost"] = None
        module, lookup, payload, path = (
            stock_service,
            "_existing_adjustment",
            adjustment_payload,
            "/api/stock/adjustments",
        )
    first = auth_client.post(path, json=payload)
    assert first.status_code == 201
    original = getattr(module, lookup)
    calls = []

    def miss_once(db, data):
        calls.append(1)
        return None if len(calls) == 1 else original(db, data)

    monkeypatch.setattr(module, lookup, miss_once)
    response = auth_client.post(path, json=payload)
    assert response.status_code == 200
    assert response.json() == first.json()
    assert len(calls) == 2


@pytest.mark.parametrize("kind", ["receipt", "adjustment"])
def test_unrelated_integrity_errors_propagate(
    auth_client, receipt_payload, adjustment_payload, monkeypatch, kind
):
    failure = IntegrityError("unrelated", {}, Exception("foreign key failure"))

    def fail(*args, **kwargs):
        raise failure

    if kind == "receipt":
        monkeypatch.setattr(receipt_service, "_post_receipt", fail)
        path, payload = "/api/receipts", receipt_payload
    else:
        monkeypatch.setattr(stock_service, "post_movements", fail)
        path, payload = "/api/stock/adjustments", adjustment_payload
    with pytest.raises(IntegrityError) as exc:
        auth_client.post(path, json=payload)
    assert exc.value is failure
