import os
import subprocess
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.config import get_settings
from tests.conftest import BACKEND_DIR, test_engine

PREVIOUS = "5c1f2a7d9e30"


def _migrate(revision: str) -> None:
    subprocess.run(
        ["uv", "run", "alembic", revision.split()[0], revision.split()[1]],
        cwd=BACKEND_DIR,
        env={**os.environ, "DATABASE_URL": get_settings().test_database_url},
        check=True,
    )


def test_old_sales_backfill_and_roundtrip() -> None:
    marker = uuid.uuid4().hex
    user_id = customer_id = sale_id = None
    try:
        _migrate(f"downgrade {PREVIOUS}")
        with test_engine.begin() as conn:
            user_id = conn.scalar(
                text(
                    "INSERT INTO users (username,password_hash,full_name) "
                    "VALUES (:name,'test','Test') RETURNING id"
                ),
                {"name": f"migration_{marker}"},
            )
            customer_id = conn.scalar(
                text("INSERT INTO customers (name) VALUES ('Migration customer') RETURNING id")
            )
            sale_id = conn.scalar(
                text(
                    "INSERT INTO sales (number,request_id,customer_id,total,created_by) "
                    "VALUES (:number,:request_id,:customer_id,12345,:user_id) RETURNING id"
                ),
                {
                    "number": 9_100_000_000 + customer_id,
                    "request_id": uuid.uuid4(),
                    "customer_id": customer_id,
                    "user_id": user_id,
                },
            )
        _migrate("upgrade head")
        with test_engine.connect() as conn:
            assert (
                conn.scalar(text("SELECT paid_at_sale FROM sales WHERE id=:id"), {"id": sale_id})
                == 12345
            )
            assert (
                conn.scalar(
                    text(
                        "SELECT column_default FROM information_schema.columns "
                        "WHERE table_name='sales' AND column_name='paid_at_sale'"
                    )
                )
                is None
            )
        for paid, target_customer in ((12346, customer_id), (-1, customer_id), (0, None)):
            with pytest.raises(IntegrityError), test_engine.begin() as conn:
                conn.execute(
                    text(
                        "INSERT INTO sales "
                        "(number,request_id,customer_id,total,paid_at_sale,created_by) "
                        "VALUES (:number,:request_id,:customer_id,12345,:paid,:user_id)"
                    ),
                    {
                        "number": 9_200_000_000 + paid + (target_customer or 0),
                        "request_id": uuid.uuid4(),
                        "customer_id": target_customer,
                        "paid": paid,
                        "user_id": user_id,
                    },
                )
        _migrate(f"downgrade {PREVIOUS}")
        _migrate("upgrade head")
        with test_engine.connect() as conn:
            assert (
                conn.scalar(text("SELECT paid_at_sale FROM sales WHERE id=:id"), {"id": sale_id})
                == 12345
            )
    finally:
        _migrate("upgrade head")
        if sale_id is not None:
            with test_engine.begin() as conn:
                conn.execute(text("DELETE FROM sales WHERE id=:id"), {"id": sale_id})
                conn.execute(text("DELETE FROM customers WHERE id=:id"), {"id": customer_id})
                conn.execute(text("DELETE FROM users WHERE id=:id"), {"id": user_id})
