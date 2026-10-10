from concurrent.futures import ThreadPoolExecutor
from threading import Event

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.inventory.models import StockBalance
from app.inventory.service import MovementIn, post_movements, round_half_up
from app.receipts.schemas import ReceiptCreate, ReceiptLineIn
from app.receipts.service import post_receipt
from tests.factories import create_product, create_user
from tests.lock_wait import wait_until_lock_waiting


def _seed(engine):
    with Session(engine) as db:
        user = create_user(db)
        product = create_product(db)
        post_movements(db, [MovementIn(product.id, 1, "receipt", unit_cost=100)], user.id)
        db.commit()
        return product.id, user.id


def test_receipt_cost_waits_for_balance_lock(isolated_stock_engine):
    engine = isolated_stock_engine
    product_id, user_id = _seed(engine)
    pid_ready = Event()
    pids = []

    def second_receipt():
        with Session(engine) as db:
            pids.append(db.scalar(select(func.pg_backend_pid())))
            pid_ready.set()
            movement = post_movements(
                db, [MovementIn(product_id, 3, "receipt", unit_cost=201)], user_id
            )[0]
            db.commit()
            return movement.unit_cost

    with Session(engine) as a, ThreadPoolExecutor(max_workers=1) as executor:
        a.scalar(
            select(StockBalance).where(StockBalance.product_id == product_id).with_for_update()
        )
        future = executor.submit(second_receipt)
        try:
            assert pid_ready.wait(5)
            wait_until_lock_waiting(pids[0], table="stock_balances")
            post_movements(a, [MovementIn(product_id, 2, "receipt", unit_cost=150)], user_id)
            a.commit()
            assert future.result(timeout=5) == 201
        finally:
            a.rollback()
    with Session(engine) as db:
        balance = db.scalar(select(StockBalance).where(StockBalance.product_id == product_id))
        expected = round_half_up(100 + 2 * 150, 3)
        expected = round_half_up(3 * expected + 3 * 201, 6)
        assert (balance.qty, balance.avg_cost) == (6, expected)


def test_parallel_receipt_documents_use_actual_posting_order(isolated_stock_engine):
    engine = isolated_stock_engine
    product_id, user_id = _seed(engine)
    ready = Event()

    def receipt(qty, cost):
        ready.wait(5)
        with Session(engine) as db:
            return post_receipt(
                db,
                ReceiptCreate(
                    lines=[ReceiptLineIn(product_id=product_id, qty=qty, unit_cost=cost)]
                ),
                user_id,
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        a = executor.submit(receipt, 2, 150)
        b = executor.submit(receipt, 3, 201)
        ready.set()
        receipts = sorted([a.result(timeout=10), b.result(timeout=10)], key=lambda row: row.number)
    qty, cost = 1, 100
    for document in receipts:
        line = document.lines[0]
        cost = round_half_up(qty * cost + line.qty * line.unit_cost, qty + line.qty)
        qty += line.qty
    with Session(engine) as db:
        balance = db.scalar(select(StockBalance).where(StockBalance.product_id == product_id))
        assert (balance.qty, balance.avg_cost) == (qty, cost)
