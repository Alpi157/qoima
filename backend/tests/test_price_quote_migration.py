import os
import subprocess
import uuid

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from tests.conftest import BACKEND_DIR, test_engine

PREVIOUS = "ac6d7e921026"
REVISION = "b7f4e1921026"


@pytest.fixture
def migration_case():
    schema = "price_quote_migration_" + uuid.uuid4().hex
    with test_engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    options = f"-csearch_path={schema},public"
    engine = create_engine(test_engine.url, connect_args={"options": options})
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE alembic_version (version_num varchar(32) PRIMARY KEY)"))

    def migrate(direction, revision, check=True):
        return subprocess.run(
            ["uv", "run", "alembic", direction, revision],
            cwd=BACKEND_DIR,
            env={
                **os.environ,
                "DATABASE_URL": test_engine.url.render_as_string(hide_password=False),
                "PGOPTIONS": options,
            },
            capture_output=True,
            text=True,
            check=check,
        )

    try:
        migrate("upgrade", PREVIOUS)
        with engine.begin() as conn:
            user = conn.scalar(
                text(
                    "INSERT INTO users (username,password_hash,full_name) "
                    "VALUES ('migration','test','Test') RETURNING id"
                )
            )
            product = conn.scalar(
                text(
                    "INSERT INTO products (article,article_norm,name,unit,sale_price) "
                    "VALUES ('MIG-28','MIG28','Migration','шт',100) RETURNING id"
                )
            )
        yield engine, migrate, {"user": user, "product": product}
    finally:
        engine.dispose()
        with test_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


def insert(conn, ids, **changes):
    values = {
        "request_id": uuid.uuid4(),
        "currency": "CNY",
        "price": 100,
        "day": "2026-10-10",
        "status": "posted",
        "cancelled": None,
        **ids,
        **changes,
    }
    return conn.scalar(
        text(
            "INSERT INTO product_price_quotes "
            "(request_id, product_id, currency, price_minor, quoted_on, status, "
            "cancelled_at, created_by) VALUES "
            "(:request_id,:product,:currency,:price,:day,:status,:cancelled,:user) RETURNING id"
        ),
        values,
    )


def test_upgrade_downgrade_upgrade(migration_case):
    engine, migrate, ids = migration_case
    for direction, target in [
        ("upgrade", REVISION),
        ("downgrade", PREVIOUS),
        ("upgrade", REVISION),
    ]:
        migrate(direction, target)
        with engine.connect() as conn:
            assert (
                conn.scalar(text("SELECT sale_price FROM products WHERE id=:product"), ids) == 100
            )
            assert conn.scalar(text("SELECT version_num FROM alembic_version")) == target
            if direction == "upgrade":
                assert "ix_product_price_quotes_latest" in {
                    v["name"] for v in inspect(conn).get_indexes("product_price_quotes")
                }
                columns = {v["name"]: v for v in inspect(conn).get_columns("product_price_quotes")}
                assert columns["created_at"]["type"].timezone
                assert not columns["request_id"]["nullable"]


@pytest.mark.parametrize("cancelled", [False, True])
def test_downgrade_refuses_all_quotes_atomically(migration_case, cancelled):
    engine, migrate, ids = migration_case
    migrate("upgrade", REVISION)
    with engine.begin() as conn:
        insert(
            conn,
            ids,
            status="cancelled" if cancelled else "posted",
            cancelled="2026-10-11T00:00:00Z" if cancelled else None,
        )
    result = migrate("downgrade", PREVIOUS, check=False)
    assert result.returncode != 0
    assert "найдено цен поставщика: 1" in result.stderr
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT version_num FROM alembic_version")) == REVISION
        assert conn.scalar(text("SELECT count(*) FROM product_price_quotes")) == 1


@pytest.mark.parametrize(
    "changes",
    [
        {"price": 0},
        {"price": -1},
        {"currency": "EUR"},
        {"status": "other"},
        {"status": "cancelled"},
        {"cancelled": "2026-10-11T00:00:00Z"},
        {"request_id": None},
        {"product": 9223372036854775807},
    ],
)
def test_constraints(migration_case, changes):
    engine, migrate, ids = migration_case
    migrate("upgrade", REVISION)
    with pytest.raises(IntegrityError), engine.begin() as conn:
        insert(conn, ids, **changes)


def test_unique_request_id(migration_case):
    engine, migrate, ids = migration_case
    migrate("upgrade", REVISION)
    request_id = uuid.uuid4()
    with engine.begin() as conn:
        insert(conn, ids, request_id=request_id)
    with pytest.raises(IntegrityError), engine.begin() as conn:
        insert(conn, ids, request_id=request_id)
