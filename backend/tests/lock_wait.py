"""PostgreSQL lock-state assertions for concurrent service tests."""

from threading import Event
from time import monotonic

from sqlalchemy import text

from tests.conftest import test_engine


def wait_until_lock_waiting(pid: int, table: str = "customers") -> None:
    """Wait for a backend to block on a PostgreSQL lock, or fail after five seconds."""
    deadline = monotonic() + 5
    poll = Event()
    # PostgreSQL caches pg_stat_activity within a transaction. Autocommit gives
    # each poll its own transaction so it observes a fresh activity snapshot.
    with test_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        while monotonic() < deadline:
            state = conn.execute(
                text("SELECT wait_event_type, query FROM pg_stat_activity WHERE pid = :pid"),
                {"pid": pid},
            ).one_or_none()
            # A foreign-key check can also wait on the customer row during INSERT.
            # That is too late: the payment has already read stale debt and taken a number.
            if (
                state is not None
                and state.wait_event_type == "Lock"
                and f"FROM {table}" in state.query
                and "FOR UPDATE" in state.query
            ):
                return
            poll.wait(min(0.01, max(0, deadline - monotonic())))
    raise AssertionError(f"B не ждёт блокировку {table} (pid={pid})")
