import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.catalog.models import Product
from app.errors import InsufficientStockError
from app.inventory.service import MovementIn, post_movements
from app.numbering import next_number
from app.receipts import service as receipts_service
from tests.factories import create_product, create_user


@pytest.fixture
def product(db_session: Session) -> Product:
    product = create_product(db_session, article="OC-90", sale_price=1000)
    user = create_user(db_session)
    post_movements(db_session, [MovementIn(product.id, 5, "receipt")], user.id)
    return product


def _sale(client: TestClient, product_id: int, qty: int) -> tuple[int, dict]:
    response = client.post(
        "/api/sales",
        json={"request_id": str(uuid.uuid4()), "lines": [{"product_id": product_id, "qty": qty}]},
    )
    return response.status_code, response.json()


def _receipt(client: TestClient, product_id: int) -> tuple[int, dict]:
    response = client.post("/api/receipts", json={"lines": [{"product_id": product_id, "qty": 1}]})
    return response.status_code, response.json()


def test_next_number_counts_up_per_doc_type(db_session: Session) -> None:
    receipt = next_number(db_session, "receipt")
    sale = next_number(db_session, "sale")

    assert next_number(db_session, "receipt") == receipt + 1
    assert next_number(db_session, "receipt") == receipt + 2
    assert next_number(db_session, "sale") == sale + 1


def test_rolled_back_number_is_reused(db_session: Session) -> None:
    first = next_number(db_session, "sale")

    rolled_back = db_session.begin_nested()
    assert next_number(db_session, "sale") == first + 1
    rolled_back.rollback()

    assert next_number(db_session, "sale") == first + 1


def test_sale_numbers_have_no_gap_after_failed_sale(
    auth_client: TestClient, product: Product
) -> None:
    status, first = _sale(auth_client, product.id, 2)
    assert status == 201

    status, error = _sale(auth_client, product.id, 10)
    assert status == 409, error

    status, second = _sale(auth_client, product.id, 2)
    assert status == 201
    assert second["number"] == first["number"] + 1


def test_receipt_numbers_have_no_gap_after_failed_receipt(
    auth_client: TestClient, product: Product, monkeypatch: pytest.MonkeyPatch
) -> None:
    status, first = _receipt(auth_client, product.id)
    assert status == 201

    # Fail after the number has been taken: the rollback must return it.
    def failing_post_movements(*_args: object, **_kwargs: object) -> None:
        raise InsufficientStockError("Сбой проведения")

    with monkeypatch.context() as patch:
        patch.setattr(receipts_service, "post_movements", failing_post_movements)
        status, error = _receipt(auth_client, product.id)
    assert status == 409, error

    status, second = _receipt(auth_client, product.id)
    assert status == 201
    assert second["number"] == first["number"] + 1


def test_cancelled_document_keeps_its_number(auth_client: TestClient, product: Product) -> None:
    _, first = _sale(auth_client, product.id, 1)
    cancelled = auth_client.post(f"/api/sales/{first['id']}/cancel", json={"reason": "Возврат"})
    _, second = _sale(auth_client, product.id, 1)

    assert cancelled.json()["number"] == first["number"]
    assert second["number"] == first["number"] + 1
