import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.customers.models import Customer
from app.customers.service import current_debt
from app.errors import PaymentExceedsDebtError, ReturnQtyExceedsSoldError, ReturnSplitChangedError
from app.inventory.service import MovementIn, post_movements
from app.payments.schemas import PaymentCreate
from app.payments.service import post_payment
from app.returns.models import SaleReturn
from app.returns.service import post_return
from app.sales.models import Sale
from tests.factories import create_customer, create_product, create_user
from tests.lock_wait import wait_until_lock_waiting
from tests.return_helpers import invariant, make_sale, return_data


def seed(engine, customer=True):
    with Session(engine) as db:
        user = create_user(db)
        buyer = create_customer(db)
        product = create_product(db)
        post_movements(db, [MovementIn(product.id, 20, "receipt", unit_cost=40)], user.id)
        case = SimpleNamespace(db=db, user=user.id, customer=buyer.id, product=product.id)
        sale = make_sale(case, customer=customer, paid=0 if customer else 1000)
        return case.user, case.customer, case.product, sale


@pytest.mark.parametrize("first", ["return", "payment"])
def test_return_and_payment_share_customer_lock(isolated_stock_engine, first):
    engine = isolated_stock_engine
    user, customer, product, sale = seed(engine)
    ready = Event()
    pids = []
    data = return_data(sale, 7)
    payment = PaymentCreate(request_id=uuid.uuid4(), customer_id=customer, amount=700)

    def other():
        with Session(engine) as db:
            pids.append(db.scalar(select(func.pg_backend_pid())))
            ready.set()
            if first == "return":
                return post_payment(db, payment, user)
            return post_return(db, data, user)[0]

    with Session(engine) as a, ThreadPoolExecutor(max_workers=1) as executor:
        a.scalar(select(Customer.id).where(Customer.id == customer).with_for_update())
        future = executor.submit(other)
        try:
            assert ready.wait(5)
            wait_until_lock_waiting(pids[0])
            if first == "return":
                result = post_return(a, data, user)[0]
                assert (result.debt_credit, result.refund_amount) == (700, 0)
                with pytest.raises(PaymentExceedsDebtError) as exc:
                    future.result(timeout=5)
                assert exc.value.params == {"debt": 300, "amount": 700}
            else:
                post_payment(a, payment, user)
                result = future.result(timeout=5)
                assert (result.debt_credit, result.refund_amount) == (300, 400)
        finally:
            a.rollback()
    with Session(engine) as db:
        assert current_debt(db, customer) == (300 if first == "return" else 0)
        invariant(SimpleNamespace(db=db, customer=customer))


@pytest.mark.parametrize("customer", [True, False])
def test_parallel_returns_cannot_exceed_sold(isolated_stock_engine, customer):
    engine = isolated_stock_engine
    user, buyer, product, sale = seed(engine, customer)
    ready = Event()
    pids = []

    def other():
        with Session(engine) as db:
            pids.append(db.scalar(select(func.pg_backend_pid())))
            ready.set()
            return post_return(db, return_data(sale, 7), user)

    with Session(engine) as a, ThreadPoolExecutor(max_workers=1) as executor:
        model, identifier = (Customer, buyer) if customer else (Sale, sale.id)
        a.scalar(select(model.id).where(model.id == identifier).with_for_update())
        future = executor.submit(other)
        try:
            assert ready.wait(5)
            wait_until_lock_waiting(pids[0], table="customers" if customer else "sales")
            post_return(a, return_data(sale, 7), user)
            with pytest.raises(ReturnQtyExceedsSoldError) as exc:
                future.result(timeout=5)
            assert exc.value.params["returned"] == 7
        finally:
            a.rollback()


def test_parallel_replay_after_waiting(isolated_stock_engine):
    engine = isolated_stock_engine
    user, buyer, product, sale = seed(engine)
    data = return_data(sale, 10)
    ready = Event()
    pids = []

    def other():
        with Session(engine) as db:
            pids.append(db.scalar(select(func.pg_backend_pid())))
            ready.set()
            return post_return(db, data, user)

    with Session(engine) as a, ThreadPoolExecutor(max_workers=1) as executor:
        a.scalar(select(Customer.id).where(Customer.id == buyer).with_for_update())
        future = executor.submit(other)
        try:
            assert ready.wait(5)
            wait_until_lock_waiting(pids[0])
            document, created = post_return(a, data, user)
            replay, second_created = future.result(timeout=5)
            assert created and not second_created and replay == document
        finally:
            a.rollback()


@pytest.mark.parametrize("payment_amount,changed", [(700, True), (100, False)])
def test_expected_split_after_concurrent_payment(isolated_stock_engine, payment_amount, changed):
    engine = isolated_stock_engine
    user, buyer, product, sale = seed(engine)
    data = return_data(sale, 7, expected_debt_credit=700, expected_refund_amount=0)
    ready = Event()
    pids = []

    def other():
        with Session(engine) as db:
            pids.append(db.scalar(select(func.pg_backend_pid())))
            ready.set()
            return post_return(db, data, user)

    with Session(engine) as a, ThreadPoolExecutor(max_workers=1) as executor:
        a.scalar(select(Customer.id).where(Customer.id == buyer).with_for_update())
        future = executor.submit(other)
        try:
            assert ready.wait(5)
            wait_until_lock_waiting(pids[0])
            post_payment(
                a,
                PaymentCreate(request_id=uuid.uuid4(), customer_id=buyer, amount=payment_amount),
                user,
            )
            if changed:
                with pytest.raises(ReturnSplitChangedError) as exc:
                    future.result(timeout=5)
                assert exc.value.params == {"debt_credit": 300, "refund_amount": 400}
            else:
                result, created = future.result(timeout=5)
                assert created and (result.debt_credit, result.refund_amount) == (700, 0)
        finally:
            a.rollback()
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(SaleReturn)) == (0 if changed else 1)
        assert current_debt(db, buyer) == (300 if changed else 200)
