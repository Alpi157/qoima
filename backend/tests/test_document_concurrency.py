import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.customers.models import Customer
from app.customers.service import current_debt
from app.db_utils import RECEIPT_REQUEST_LOCK, STOCK_ADJUSTMENT_REQUEST_LOCK, lock_request_id
from app.debt_adjustments.schemas import DebtAdjustmentCreate
from app.debt_adjustments.service import post_debt_adjustment
from app.errors import AdjustmentCostNotAllowedError
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


@pytest.mark.parametrize("supplied_cost", [None, 200])
def test_adjustment_validates_cost_after_receipt_lock(isolated_stock_engine, supplied_cost):
    engine = isolated_stock_engine
    with Session(engine) as db:
        user = create_user(db).id
        product = create_product(db).id
        post_movements(db, [MovementIn(product, 2, "receipt")], user)
        db.commit()
    ready = Event()
    pids = []

    def other():
        with Session(engine) as db:
            pids.append(db.scalar(select(func.pg_backend_pid())))
            ready.set()
            return create_adjustment(
                db,
                AdjustmentCreate(
                    request_id=uuid.uuid4(),
                    product_id=product,
                    qty=1,
                    unit_cost=supplied_cost,
                    reason="Пересчёт",
                ),
                user,
            )

    with Session(engine) as owner, ThreadPoolExecutor(max_workers=1) as executor:
        post_movements(owner, [MovementIn(product, 1, "receipt", unit_cost=100)], user)
        future = executor.submit(other)
        try:
            assert ready.wait(5)
            wait_until_lock_waiting(pids[0], "stock_balances", allow_insert=True)
            owner.commit()
            if supplied_cost is None:
                result, created = future.result(timeout=5)
                assert created and result.stock == 4
            else:
                with pytest.raises(AdjustmentCostNotAllowedError):
                    future.result(timeout=5)
        finally:
            owner.rollback()
    with Session(engine) as db:
        row = db.scalar(select(StockBalance).where(StockBalance.product_id == product))
        assert row.avg_cost == 100
        assert row.qty == (4 if supplied_cost is None else 3)


@pytest.mark.parametrize("source", ["nbk", "manual"])
def test_parallel_currency_receipt_50_runs(isolated_stock_engine, monkeypatch, source):
    from datetime import date
    from decimal import Decimal

    from app.rates.models import ExchangeRate
    from app.rates.schemas import RateOut
    from app.receipts import service as receipt_service
    from app.receipts.models import ReceiptExpense, ReceiptExpenseAllocation

    engine = isolated_stock_engine
    factory = sessionmaker(bind=engine)
    monkeypatch.setattr(
        receipt_service,
        "get_rate",
        lambda currency, day, **kwargs: RateOut(
            currency=currency, requested_date=day, rate_date=day, rate=Decimal("70"), exact=True
        ),
    )
    with Session(engine) as db:
        user = create_user(db).id
        products = [create_product(db).id for _ in range(2)]
        db.add(
            ExchangeRate(
                rate_date=date(2026, 10, 14), currency="CNY", rate=Decimal("70"), source="nbk"
            )
        )
        db.commit()
    with ThreadPoolExecutor(max_workers=1) as executor:
        for run in range(50):
            request_id = uuid.uuid4()
            payload = ReceiptCreate(
                request_id=request_id,
                received_at="2026-10-14T12:00:00Z",
                currency="CNY",
                exchange_rate="70",
                rate_date="2026-10-14" if source == "nbk" else None,
                rate_source=source,
                lines=[{"product_id": pid, "qty": 1, "unit_price_minor": 100} for pid in products],
                expenses=[
                    {"kind": "delivery", "amount_minor": 101},
                    {"kind": "import_vat", "amount_minor": 13},
                ],
            )
            ready = Event()
            pids = []

            def other(payload=payload, pids=pids, ready=ready):
                with Session(engine) as db:
                    pids.append(db.scalar(select(func.pg_backend_pid())))
                    ready.set()
                    return post_receipt(db, payload, user, session_factory=factory)

            with Session(engine) as owner:
                lock_request_id(owner, RECEIPT_REQUEST_LOCK, request_id)
                future = executor.submit(other)
                try:
                    assert ready.wait(5)
                    wait_until_advisory_lock_waiting(pids[0], RECEIPT_REQUEST_LOCK, request_id)
                    first, created = post_receipt(owner, payload, user, session_factory=factory)
                    replay, replay_created = future.result(timeout=5)
                    assert created and not replay_created and first == replay
                finally:
                    owner.rollback()
            with Session(engine) as db:
                assert db.scalar(select(func.count()).select_from(Receipt)) == run + 1
                assert db.scalar(select(func.count()).select_from(ReceiptExpense)) == 2 * (run + 1)
                assert db.scalar(
                    select(func.count()).select_from(ReceiptExpenseAllocation)
                ) == 4 * (run + 1)
                assert db.scalar(select(func.count()).select_from(StockMovement)) == 2 * (run + 1)
                assert (
                    db.scalar(
                        select(DocumentCounter.last_number).where(
                            DocumentCounter.doc_type == "receipt"
                        )
                    )
                    == run + 1
                )
                assert (
                    db.scalars(select(StockBalance.qty).order_by(StockBalance.product_id)).all()
                    == [run + 1] * 2
                )


def test_manual_rate_precedes_advisory_lock_and_document_writes(isolated_stock_engine, monkeypatch):
    from datetime import date
    from decimal import Decimal

    from app.rates.schemas import RateOut
    from app.receipts import service as receipt_service

    engine = isolated_stock_engine
    factory = sessionmaker(bind=engine)
    with factory() as db:
        user = create_user(db).id
        product = create_product(db).id
        db.commit()
    payload = ReceiptCreate(
        request_id=uuid.uuid4(),
        currency="CNY",
        exchange_rate="80",
        rate_source="manual",
        received_at="2026-10-14T12:00:00Z",
        lines=[{"product_id": product, "qty": 1, "unit_price_minor": 100}],
    )
    fetched, ready = Event(), Event()
    statements, pids = [], []
    phase = {"locked": False}

    def compare(currency, day, *, session_factory):
        assert session_factory is factory
        fetched.set()
        return RateOut(
            currency=currency,
            requested_date=day,
            rate_date=date(2026, 10, 14),
            rate=Decimal("70"),
            exact=True,
        )

    monkeypatch.setattr(receipt_service, "get_rate", compare)

    def record(conn, cursor, statement, parameters, context, executemany):
        sql = " ".join(statement.upper().split())
        if "PG_ADVISORY_XACT_LOCK" in sql:
            phase["locked"] = True
        if not phase["locked"]:
            assert sql.startswith("SELECT "), sql
            assert not any(
                token in sql
                for token in (
                    "FOR UPDATE",
                    "FOR SHARE",
                    "FOR NO KEY UPDATE",
                    "FOR KEY SHARE",
                    "PG_ADVISORY",
                )
            ), sql
            statements.append(sql)

    def other():
        with factory() as db:
            pids.append(db.scalar(select(func.pg_backend_pid())))
            connection = db.connection()
            event.listen(connection, "before_cursor_execute", record)
            ready.set()
            try:
                return post_receipt(db, payload, user, session_factory=factory)
            finally:
                event.remove(connection, "before_cursor_execute", record)

    with factory() as owner, ThreadPoolExecutor(max_workers=1) as executor:
        lock_request_id(owner, RECEIPT_REQUEST_LOCK, payload.request_id)
        future = executor.submit(other)
        try:
            assert ready.wait(5)
            assert fetched.wait(5), "get_rate must finish before waiting on the advisory lock"
            wait_until_advisory_lock_waiting(pids[0], RECEIPT_REQUEST_LOCK, payload.request_id)
            assert len(statements) == 1 and "FROM RECEIPTS" in statements[0]
            first, created = post_receipt(owner, payload, user, session_factory=factory)
            replay, replay_created = future.result(timeout=5)
            assert created and not replay_created and replay == first
        finally:
            owner.rollback()
