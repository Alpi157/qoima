import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from time import monotonic

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.customers.models import Customer
from app.customers.service import current_debt
from app.debt_adjustments.models import CustomerDebtAdjustment
from app.debt_adjustments.schemas import DebtAdjustmentCreate
from app.debt_adjustments.service import post_debt_adjustment
from app.errors import (
    DebtAdjustmentExceedsDebtError,
    DebtAdjustmentRequestConflictError,
    PaymentExceedsDebtError,
)
from app.numbering import DocumentCounter
from app.payments.schemas import PaymentCreate
from app.payments.service import post_payment
from tests.factories import create_customer, create_user
from tests.lock_wait import wait_until_lock_waiting


def seed(engine):
    with Session(engine) as db:
        user = create_user(db)
        customer = create_customer(db)
        db.commit()
        post_debt_adjustment(db, data(customer.id, 1000), user.id)
        return customer.id, user.id


def data(customer, amount, **changes):
    return DebtAdjustmentCreate(
        request_id=changes.pop("request_id", uuid.uuid4()),
        customer_id=customer,
        amount=amount,
        reason="Opening",
        **changes,
    )


def operate(db, kind, customer, amount, user):
    if kind == "decrease":
        return post_debt_adjustment(db, data(customer, -amount), user)
    return post_payment(
        db, PaymentCreate(request_id=uuid.uuid4(), customer_id=customer, amount=amount), user
    )


@pytest.mark.parametrize("first", ["decrease", "payment"])
@pytest.mark.parametrize("first_amount", [700, 300])
def test_parallel_decrease_payment_waits_and_uses_current_debt(
    isolated_stock_engine, first, first_amount
):
    engine = isolated_stock_engine
    customer, user = seed(engine)
    second = "payment" if first == "decrease" else "decrease"
    ready = Event()
    pids = []

    def other():
        with Session(engine) as db:
            pids.append(db.scalar(select(func.pg_backend_pid())))
            ready.set()
            return operate(db, second, customer, 700, user)

    with Session(engine) as owner, ThreadPoolExecutor(max_workers=1) as executor:
        owner.scalar(select(Customer.id).where(Customer.id == customer).with_for_update())
        future = executor.submit(other)
        try:
            assert ready.wait(5)
            wait_until_lock_waiting(pids[0])
            operate(owner, first, customer, first_amount, user)
            if first_amount == 700:
                error = (
                    PaymentExceedsDebtError
                    if second == "payment"
                    else DebtAdjustmentExceedsDebtError
                )
                with pytest.raises(error) as exc:
                    future.result(timeout=5)
                assert exc.value.params == {
                    "debt": 300,
                    "amount": 700 if second == "payment" else -700,
                }
            else:
                assert future.result(timeout=5)[1]
        finally:
            owner.rollback()
    with Session(engine) as db:
        assert current_debt(db, customer) == (300 if first_amount == 700 else 0)


@pytest.mark.parametrize("amount", [100, -1000])
def test_parallel_replay_checks_after_customer_lock(isolated_stock_engine, amount):
    engine = isolated_stock_engine
    customer, user = seed(engine)
    payload = data(customer, amount)
    ready = Event()
    pids = []

    def other():
        with Session(engine) as db:
            pids.append(db.scalar(select(func.pg_backend_pid())))
            ready.set()
            return post_debt_adjustment(db, payload, user)

    with Session(engine) as owner, ThreadPoolExecutor(max_workers=1) as executor:
        owner.scalar(select(Customer.id).where(Customer.id == customer).with_for_update())
        future = executor.submit(other)
        try:
            assert ready.wait(5)
            wait_until_lock_waiting(pids[0])
            document, created = post_debt_adjustment(owner, payload, user)
            replay, second_created = future.result(timeout=5)
            assert created and not second_created and replay == document
        finally:
            owner.rollback()
    with Session(engine) as db:
        assert current_debt(db, customer) == 1000 + amount
        assert db.scalar(select(func.count()).select_from(CustomerDebtAdjustment)) == 2
        assert (
            db.scalar(
                select(DocumentCounter.last_number).where(
                    DocumentCounter.doc_type == "debt_adjustment"
                )
            )
            == 2
        )


def test_request_id_collision_across_customers_rolls_back_counter(isolated_stock_engine):
    engine = isolated_stock_engine
    first, user = seed(engine)
    with Session(engine) as db:
        other = create_customer(db)
        db.commit()
        other_id = other.id
    payload = data(first, 100)
    ready = Event()
    pids = []

    def other_post():
        with Session(engine) as db:
            pids.append(db.scalar(select(func.pg_backend_pid())))
            ready.set()
            return post_debt_adjustment(
                db, data(other_id, 100, request_id=payload.request_id), user
            )

    with Session(engine) as owner, ThreadPoolExecutor(max_workers=1) as executor:
        owner.scalar(
            select(DocumentCounter.last_number)
            .where(DocumentCounter.doc_type == "debt_adjustment")
            .with_for_update()
        )
        future = executor.submit(other_post)
        try:
            assert ready.wait(5)
            # The other customer does not serialize this request; the counter does.
            deadline = monotonic() + 5
            poll = Event()
            while True:
                with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
                    waiting = observer.scalar(
                        text("SELECT wait_event_type='Lock' FROM pg_stat_activity WHERE pid=:pid"),
                        {"pid": pids[0]},
                    )
                if waiting:
                    break
                assert monotonic() < deadline
                poll.wait(0.01)
            post_debt_adjustment(owner, payload, user)
            with pytest.raises(DebtAdjustmentRequestConflictError):
                future.result(timeout=5)
        finally:
            owner.rollback()
    with Session(engine) as db:
        assert current_debt(db, other_id) == 0
        assert (
            db.scalar(
                select(DocumentCounter.last_number).where(
                    DocumentCounter.doc_type == "debt_adjustment"
                )
            )
            == 2
        )
