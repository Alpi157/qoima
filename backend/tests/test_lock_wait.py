from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from app.customers.models import Customer
from tests.conftest import test_engine
from tests.factories import create_customer
from tests.lock_wait import wait_until_lock_waiting


@pytest.fixture
def committed_customer_id() -> Generator[int, None, None]:
    with Session(test_engine) as db:
        customer_id = create_customer(db).id
        db.commit()
    try:
        yield customer_id
    finally:
        with Session(test_engine) as db:
            db.query(Customer).filter_by(id=customer_id).delete()
            db.commit()


def test_lock_wait_refreshes_activity_after_first_poll(committed_customer_id: int) -> None:
    pid_ready = Event()
    first_poll_done = Event()
    pids: list[int] = []
    polls = 0

    def after_poll(conn, cursor, statement, parameters, context, executemany) -> None:
        nonlocal polls
        if "FROM pg_stat_activity" in statement:
            polls += 1
            # The first query has already captured B before it attempts the lock.
            first_poll_done.set()

    def lock_customer() -> int:
        with Session(test_engine) as db:
            pids.append(db.scalar(select(func.pg_backend_pid())))
            pid_ready.set()
            assert first_poll_done.wait(5), "Наблюдатель не выполнил первый опрос"
            return db.scalar(
                select(Customer.id).where(Customer.id == committed_customer_id).with_for_update()
            )

    with Session(test_engine) as a, ThreadPoolExecutor(max_workers=1) as executor:
        a.scalar(select(Customer.id).where(Customer.id == committed_customer_id).with_for_update())
        event.listen(test_engine, "after_cursor_execute", after_poll)
        try:
            b = executor.submit(lock_customer)
            assert pid_ready.wait(5), "B не передал pg_backend_pid()"
            wait_until_lock_waiting(pids[0])
            assert polls >= 2, "Ожидание блокировки должно появиться после первого опроса"
        finally:
            event.remove(test_engine, "after_cursor_execute", after_poll)
            first_poll_done.set()
            a.rollback()
        assert b.result(timeout=5) == committed_customer_id
