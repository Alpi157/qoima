import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.customers.models import Customer
from app.customers.service import current_debt
from app.db_utils import RECEIPT_REQUEST_LOCK, STOCK_ADJUSTMENT_REQUEST_LOCK, lock_request_id
from app.debt_adjustments.schemas import DebtAdjustmentCreate
from app.debt_adjustments.service import post_debt_adjustment
from app.inventory.models import StockBalance, StockMovement
from app.inventory.schemas import AdjustmentCreate
from app.inventory.service import MovementIn, create_adjustment, post_movements
from app.numbering import DocumentCounter
from app.payments.models import CustomerPayment
from app.payments.schemas import PaymentCreate
from app.payments.service import post_payment
from app.receipts.models import Receipt
from app.receipts.schemas import ReceiptCreate, ReceiptLineIn
from app.receipts.service import post_receipt
from tests.factories import create_customer, create_product, create_user
from tests.lock_wait import wait_until_advisory_lock_waiting, wait_until_lock_waiting


@pytest.mark.parametrize("kind", ["receipt", "adjustment", "payment"])
def test_parallel_identical_document(isolated_stock_engine, kind):
    engine = isolated_stock_engine
    with Session(engine) as db:
        user = create_user(db).id
        product = create_product(db).id
        customer = create_customer(db).id
        post_movements(db, [MovementIn(product, 5, "receipt", unit_cost=100)], user)
        db.commit()
        post_debt_adjustment(
            db,
            DebtAdjustmentCreate(
                request_id=uuid.uuid4(), customer_id=customer, amount=1000, reason="Opening"
            ),
            user,
        )
    request_id = uuid.uuid4()
    if kind == "receipt":
        payload = ReceiptCreate(
            request_id=request_id, lines=[ReceiptLineIn(product_id=product, qty=2, unit_cost=100)]
        )
        service, namespace = post_receipt, RECEIPT_REQUEST_LOCK
    elif kind == "adjustment":
        payload = AdjustmentCreate(
            request_id=request_id, product_id=product, qty=-5, reason="Пересчёт"
        )
        service, namespace = create_adjustment, STOCK_ADJUSTMENT_REQUEST_LOCK
    else:
        payload = PaymentCreate(request_id=request_id, customer_id=customer, amount=1000)
        service, namespace = post_payment, None
    ready = Event()
    pids = []

    def other():
        with Session(engine) as db:
            pids.append(db.scalar(select(func.pg_backend_pid())))
            ready.set()
            return service(db, payload, user)

    with Session(engine) as owner, ThreadPoolExecutor(max_workers=1) as executor:
        if namespace is None:
            owner.scalar(select(Customer.id).where(Customer.id == customer).with_for_update())
        else:
            lock_request_id(owner, namespace, request_id)
        future = executor.submit(other)
        try:
            assert ready.wait(5)
            if namespace is None:
                wait_until_lock_waiting(pids[0])
            else:
                wait_until_advisory_lock_waiting(pids[0], namespace, request_id)
            first, created = service(owner, payload, user)
            replay, second_created = future.result(timeout=5)
            assert created and not second_created
            assert replay == first
        finally:
            owner.rollback()
    with Session(engine) as db:
        assert (
            db.scalar(select(StockBalance.qty).where(StockBalance.product_id == product))
            == {"receipt": 7, "adjustment": 0, "payment": 5}[kind]
        )
        assert db.scalar(select(func.count()).select_from(Receipt)) == int(kind == "receipt")
        assert db.scalar(select(func.count()).select_from(StockMovement)) == (
            1 if kind == "payment" else 2
        )
        assert db.scalar(select(func.count()).select_from(CustomerPayment)) == int(
            kind == "payment"
        )
        assert current_debt(db, customer) == (0 if kind == "payment" else 1000)
        for document in ("receipt", "payment"):
            assert db.scalar(
                select(DocumentCounter.last_number).where(DocumentCounter.doc_type == document)
            ) == int(kind == document)


def test_request_lock_namespaces_are_independent(isolated_stock_engine):
    request_id = uuid.uuid4()
    with Session(isolated_stock_engine) as owner:
        lock_request_id(owner, RECEIPT_REQUEST_LOCK, request_id)
        with Session(isolated_stock_engine) as other:
            other.execute(select(func.set_config("lock_timeout", "1000", True)))
            lock_request_id(other, STOCK_ADJUSTMENT_REQUEST_LOCK, request_id)
