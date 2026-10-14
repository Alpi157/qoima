import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Event

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.models import User
from app.catalog.models import Product
from app.customers.models import Customer
from app.customers.service import current_debt
from app.errors import PaymentExceedsDebtError
from app.inventory.service import MovementIn, post_movements
from app.numbering import DocumentCounter, next_number
from app.payments.models import CustomerPayment
from app.payments.schemas import PaymentCreate
from app.payments.service import cancel_payment, post_payment
from app.sales.models import Sale
from tests.conftest import test_engine
from tests.factories import create_customer, create_product, create_user
from tests.lock_wait import wait_until_lock_waiting


@pytest.fixture
def debt_case(auth_client: TestClient, db_session: Session) -> tuple[int, int]:
    customer = create_customer(db_session, name="Должник")
    product = create_product(db_session, article="DEBT-1", sale_price=100_000)
    user = create_user(db_session)
    post_movements(db_session, [MovementIn(product.id, 10, "receipt")], user.id)
    sale = auth_client.post(
        "/api/sales",
        json={
            "request_id": str(uuid.uuid4()),
            "customer_id": customer.id,
            "paid_amount": 20_000,
            "lines": [{"product_id": product.id, "qty": 1, "unit_price": 100_000}],
        },
    )
    assert sale.status_code == 201, sale.text
    return customer.id, sale.json()["id"]


def _pay(client: TestClient, customer_id: int, amount: int, **other: object):
    return client.post(
        "/api/payments",
        json={
            "request_id": str(uuid.uuid4()),
            "customer_id": customer_id,
            "amount": amount,
            **other,
        },
    )


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/payments"),
        ("get", "/api/payments/1"),
        ("post", "/api/payments"),
        ("post", "/api/payments/1/cancel"),
        ("get", "/api/customers/debts"),
        ("get", "/api/customers/1/ledger"),
    ],
)
def test_new_routes_require_login(client: TestClient, method: str, path: str) -> None:
    assert client.request(method, path, json={}).status_code == 401


def test_payment_lifecycle_and_balances(
    auth_client: TestClient, debt_case: tuple[int, int]
) -> None:
    customer_id, sale_id = debt_case
    assert auth_client.get(f"/api/customers/{customer_id}").json()["debt"] == 80_000
    first = _pay(auth_client, customer_id, 30_000, note="  наличные  ")
    assert first.status_code == 201, first.text
    payment = first.json()
    assert payment["note"] == "наличные"
    assert payment["customer"]["id"] == customer_id
    assert auth_client.get(f"/api/customers/{customer_id}").json()["debt"] == 50_000
    assert auth_client.get("/api/customers?q=Должник").json()["items"][0]["debt"] == 50_000
    assert auth_client.get("/api/customers/recent").json()[0]["debt"] == 50_000
    assert auth_client.get(f"/api/payments/{payment['id']}").json() == payment
    listed = auth_client.get("/api/payments").json()
    assert listed["total"] == 1 and listed["sum_posted"] == 30_000
    assert listed["items"][0] == payment
    cancelled = auth_client.post(f"/api/payments/{payment['id']}/cancel", json={"reason": "Ошибка"})
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert auth_client.get(f"/api/customers/{customer_id}").json()["debt"] == 80_000
    assert (
        auth_client.post(f"/api/payments/{payment['id']}/cancel", json={"reason": "Ошибка"}).json()[
            "code"
        ]
        == "payment_already_cancelled"
    )
    later = _pay(auth_client, customer_id, 50_000)
    assert later.status_code == 201
    assert later.json()["number"] == payment["number"] + 1
    for item in auth_client.get("/api/payments").json()["items"]:
        assert item == auth_client.get(f"/api/payments/{item['id']}").json()
    auth_client.post(f"/api/sales/{sale_id}/cancel", json={"reason": "Возврат"})
    assert auth_client.get(f"/api/customers/{customer_id}").json()["debt"] == -50_000
    assert _pay(auth_client, customer_id, 1).json()["code"] == "payment_exceeds_debt"


def test_payment_replay_and_conflict(auth_client: TestClient, debt_case: tuple[int, int]) -> None:
    customer_id, _ = debt_case
    paid_at = "2026-01-01T10:00:00+05:00"
    request_id = str(uuid.uuid4())
    payload = {
        "request_id": request_id,
        "customer_id": customer_id,
        "amount": 10_000,
        "paid_at": paid_at,
        "note": "первый",
    }
    first = auth_client.post("/api/payments", json=payload)
    assert first.status_code == 201
    repeat = auth_client.post("/api/payments", json={**payload, "paid_at": "2026-01-01T05:00:00Z"})
    assert repeat.status_code == 200 and repeat.json() == first.json()
    conflict = auth_client.post("/api/payments", json={**payload, "note": "другой"})
    assert conflict.status_code == 409 and conflict.json()["code"] == "payment_request_conflict"
    without_date = {"request_id": str(uuid.uuid4()), "customer_id": customer_id, "amount": 1}
    assert auth_client.post("/api/payments", json=without_date).status_code == 201
    assert auth_client.post("/api/payments", json=without_date).status_code == 200


def test_payment_errors_and_gapless_numbers(
    auth_client: TestClient, db_session: Session, debt_case: tuple[int, int]
) -> None:
    customer_id, _ = debt_case
    last_number = db_session.scalar(
        select(DocumentCounter.last_number).where(DocumentCounter.doc_type == "payment")
    )
    assert _pay(auth_client, customer_id, 80_001).json() == {
        "detail": "Оплата больше долга",
        "code": "payment_exceeds_debt",
        "params": {"debt": 80_000, "amount": 80_001},
    }
    first = _pay(auth_client, customer_id, 20_000).json()
    assert first["number"] == last_number + 1
    assert _pay(auth_client, 9223372036854775807, 1).json()["code"] == "document_customer_not_found"
    assert (
        _pay(
            auth_client,
            customer_id,
            1,
            paid_at=(datetime.now(UTC) + timedelta(hours=1)).isoformat(),
        ).json()["code"]
        == "validation_error"
    )
    assert _pay(auth_client, customer_id, 0).status_code == 422
    second = _pay(auth_client, customer_id, 20_000).json()
    assert second["number"] == first["number"] + 1
    assert (
        auth_client.get("/api/payments/9223372036854775807").json()["code"] == "payment_not_found"
    )


def test_debts_and_ledger(
    auth_client: TestClient, db_session: Session, debt_case: tuple[int, int]
) -> None:
    customer_id, sale_id = debt_case
    _pay(auth_client, customer_id, 10_000, paid_at="2026-01-01T09:00:00+05:00")
    ledger = auth_client.get(f"/api/customers/{customer_id}/ledger?limit=1&offset=1").json()
    assert ledger["total"] == 2
    assert ledger["items"][0]["kind"] == "payment"
    assert ledger["items"][0]["debt_after"] == -10_000
    debts = auth_client.get("/api/customers/debts?limit=1&offset=0").json()
    assert debts["total"] == 1 and debts["total_debt"] == 70_000
    assert debts["debtors_count"] == 1
    assert debts["items"][0]["id"] == customer_id
    assert auth_client.get("/api/customers/debts").status_code == 200
    auth_client.post(f"/api/sales/{sale_id}/cancel", json={"reason": "Возврат"})
    assert auth_client.get("/api/customers/debts").json()["items"][0]["debt"] == -10_000


def test_fully_paid_sale_appears_in_ledger(
    auth_client: TestClient, db_session: Session, debt_case: tuple[int, int]
) -> None:
    customer_id, _ = debt_case
    product_id = db_session.scalar(select(Product.id).where(Product.article == "DEBT-1"))
    response = auth_client.post(
        "/api/sales",
        json={
            "request_id": str(uuid.uuid4()),
            "customer_id": customer_id,
            "lines": [{"product_id": product_id, "qty": 1, "unit_price": 100_000}],
        },
    )
    assert response.status_code == 201
    sale = response.json()
    items = auth_client.get(f"/api/customers/{customer_id}/ledger").json()["items"]
    fully_paid = next(item for item in items if item["id"] == sale["id"] and item["kind"] == "sale")
    assert fully_paid["amount"] == sale["total"]
    assert fully_paid["paid_at_sale"] == sale["total"]
    assert fully_paid["debt_change"] == 0


def test_payment_date_filters_use_almaty_days(
    auth_client: TestClient, debt_case: tuple[int, int]
) -> None:
    customer_id, _ = debt_case
    _pay(auth_client, customer_id, 10_000, paid_at="2026-03-10T18:59:00Z")
    _pay(auth_client, customer_id, 20_000, paid_at="2026-03-10T19:00:00Z")
    first_day = auth_client.get("/api/payments?from=2026-03-10&to=2026-03-10").json()
    second_day = auth_client.get("/api/payments?from=2026-03-11&to=2026-03-11").json()
    assert first_day["total"] == 1 and first_day["sum_posted"] == 10_000
    assert second_day["total"] == 1 and second_day["sum_posted"] == 20_000


def test_zero_debt_rejects_payment(auth_client: TestClient, debt_case: tuple[int, int]) -> None:
    customer_id, _ = debt_case
    assert _pay(auth_client, customer_id, 80_000).status_code == 201
    response = _pay(auth_client, customer_id, 1)
    assert response.status_code == 409
    assert response.json()["params"] == {"debt": 0, "amount": 1}


def test_debts_order_and_page_totals(
    auth_client: TestClient, db_session: Session, debt_case: tuple[int, int]
) -> None:
    first_id, _ = debt_case
    product_id = db_session.scalar(select(Product.id).where(Product.article == "DEBT-1"))
    second = create_customer(db_session, name="Меньший долг")
    third = create_customer(db_session, name="Переплата")
    for customer, paid in ((second, 60_000), (third, 0)):
        response = auth_client.post(
            "/api/sales",
            json={
                "request_id": str(uuid.uuid4()),
                "customer_id": customer.id,
                "paid_amount": paid,
                "lines": [{"product_id": product_id, "qty": 1, "unit_price": 100_000}],
            },
        )
        assert response.status_code == 201
        if customer.id == third.id:
            _pay(auth_client, third.id, 10_000)
            auth_client.post(
                f"/api/sales/{response.json()['id']}/cancel", json={"reason": "Возврат"}
            )
    page = auth_client.get("/api/customers/debts?limit=1&offset=1").json()
    assert page["total"] == 3
    assert page["total_debt"] == 120_000
    assert page["debtors_count"] == 2
    assert [item["id"] for item in page["items"]] == [second.id]
    all_items = auth_client.get("/api/customers/debts").json()["items"]
    assert [item["id"] for item in all_items] == [first_id, second.id, third.id]


def test_payment_database_check(db_session: Session, debt_case: tuple[int, int]) -> None:
    customer_id, _ = debt_case
    customer_payment = CustomerPayment(
        number=1000,
        request_id=uuid.uuid4(),
        customer_id=customer_id,
        amount=0,
        created_by=1,
        payment_method="cash",
    )
    nested = db_session.begin_nested()
    db_session.add(customer_payment)
    with pytest.raises(IntegrityError):
        db_session.flush()
    nested.rollback()


@pytest.fixture
def committed_debt_case():
    marker = uuid.uuid4().hex
    with Session(test_engine) as db:
        user = create_user(db, username=f"parallel_{marker}")
        customer = create_customer(db, name=f"Parallel {marker}")
        db.add(
            Sale(
                number=9_000_000_000 + customer.id,
                request_id=uuid.uuid4(),
                customer_id=customer.id,
                total=100,
                paid_at_sale=0,
                created_by=user.id,
            )
        )
        db.commit()
        customer_id, user_id = customer.id, user.id
    try:
        yield customer_id, user_id
    finally:
        with Session(test_engine) as db:
            db.query(CustomerPayment).filter_by(customer_id=customer_id).delete()
            db.query(Sale).filter_by(customer_id=customer_id).delete()
            db.query(Customer).filter_by(id=customer_id).delete()
            db.query(User).filter_by(id=user_id).delete()
            db.commit()


def _other_connection_payment(
    customer_id: int, user_id: int, pid_ready: Event, pids: list[int]
) -> None:
    with Session(test_engine) as db:
        pids.append(db.scalar(select(func.pg_backend_pid())))
        pid_ready.set()
        post_payment(
            db,
            PaymentCreate(request_id=uuid.uuid4(), customer_id=customer_id, amount=70),
            user_id,
        )


def test_parallel_payments_cannot_overpay(committed_debt_case: tuple[int, int]) -> None:
    customer_id, user_id = committed_debt_case
    pid_ready = Event()
    pids: list[int] = []
    with Session(test_engine) as a, ThreadPoolExecutor(max_workers=1) as executor:
        a.scalar(select(Customer.id).where(Customer.id == customer_id).with_for_update())
        b = executor.submit(_other_connection_payment, customer_id, user_id, pid_ready, pids)
        try:
            assert pid_ready.wait(5), "B не передал pg_backend_pid()"
            wait_until_lock_waiting(pids[0])
            a.add(
                CustomerPayment(
                    number=next_number(a, "payment"),
                    request_id=uuid.uuid4(),
                    customer_id=customer_id,
                    amount=70,
                    payment_method="cash",
                    created_by=user_id,
                )
            )
            a.commit()
            with pytest.raises(PaymentExceedsDebtError) as exc:
                b.result(timeout=5)
            assert exc.value.params == {"debt": 30, "amount": 70}
        finally:
            a.rollback()


def test_cancel_payment_releases_debt_for_parallel_payment(
    committed_debt_case: tuple[int, int],
) -> None:
    customer_id, user_id = committed_debt_case
    with Session(test_engine) as setup:
        initial, _ = post_payment(
            setup,
            PaymentCreate(request_id=uuid.uuid4(), customer_id=customer_id, amount=70),
            user_id,
        )
    pid_ready = Event()
    pids: list[int] = []
    with Session(test_engine) as a, ThreadPoolExecutor(max_workers=1) as executor:
        a.scalar(select(Customer.id).where(Customer.id == customer_id).with_for_update())
        b = executor.submit(_other_connection_payment, customer_id, user_id, pid_ready, pids)
        try:
            assert pid_ready.wait(5), "B не передал pg_backend_pid()"
            wait_until_lock_waiting(pids[0])
            cancel_payment(a, initial.id, "Ошибка оплаты", user_id)
            b.result(timeout=5)
        finally:
            a.rollback()
    with Session(test_engine) as db:
        assert current_debt(db, customer_id) == 30
