import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db_utils import lock_request_id
from app.errors import PriceQuoteRequestConflictError
from app.price_quotes.models import ProductPriceQuote
from app.price_quotes.schemas import PriceQuoteCreate
from app.price_quotes.service import PRICE_QUOTE_REQUEST_LOCK, create_quote
from tests.factories import create_product, create_user
from tests.lock_wait import wait_until_advisory_lock_waiting


@pytest.mark.parametrize("conflict", [False, True])
def test_concurrent_quote_50_runs(isolated_stock_engine, conflict):
    engine = isolated_stock_engine
    with Session(engine) as db:
        user = create_user(db).id
        product = create_product(db).id
        db.commit()
    with ThreadPoolExecutor(max_workers=1) as executor:
        for run in range(50):
            payload = PriceQuoteCreate(
                request_id=uuid.uuid4(), currency="CNY", price_minor=100, quoted_on="2026-10-01"
            )
            other_payload = payload.model_copy(update={"price_minor": 101}) if conflict else payload
            ready, pids = Event(), []

            def other(data=other_payload, ready=ready, pids=pids):
                with Session(engine) as db:
                    pids.append(db.scalar(select(func.pg_backend_pid())))
                    ready.set()
                    return create_quote(db, product, data, user)

            with Session(engine) as owner:
                lock_request_id(owner, PRICE_QUOTE_REQUEST_LOCK, payload.request_id)
                future = executor.submit(other)
                try:
                    assert ready.wait(5)
                    wait_until_advisory_lock_waiting(
                        pids[0], PRICE_QUOTE_REQUEST_LOCK, payload.request_id
                    )
                    first, created = create_quote(owner, product, payload, user)
                    assert created
                    if conflict:
                        with pytest.raises(PriceQuoteRequestConflictError) as exc:
                            future.result(timeout=5)
                        assert exc.value.params == {"id": first.id}
                    else:
                        replay, replay_created = future.result(timeout=5)
                        assert not replay_created and replay == first
                finally:
                    owner.rollback()
            with Session(engine) as db:
                assert db.scalar(select(func.count()).select_from(ProductPriceQuote)) == run + 1
