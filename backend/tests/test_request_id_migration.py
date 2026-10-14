import os
import subprocess
import uuid

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from tests.conftest import BACKEND_DIR, test_engine

PREVIOUS = "42b8e0f713ac"
REVISION = "6e2a4b9c1022"


@pytest.fixture
def migration_case():
    schema = "request_id_migration_" + uuid.uuid4().hex
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
                    "INSERT INTO products (article,article_norm,name) "
                    "VALUES ('MIG','MIG','Migration') RETURNING id"
                )
            )
            warehouse = conn.scalar(text("SELECT id FROM warehouses WHERE code='main'"))
            conn.execute(
                text("INSERT INTO receipts (number,created_by) VALUES (1,:u)"), {"u": user}
            )
            conn.execute(
                text(
                    "INSERT INTO stock_movements (product_id,warehouse_id,qty,kind,created_by) "
                    "VALUES (:p,:w,5,'adjustment',:u)"
                ),
                {"p": product, "w": warehouse, "u": user},
            )
        yield engine, migrate, {"u": user, "p": product, "w": warehouse}
    finally:
        engine.dispose()
        with test_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


def insert_keyed(conn, ids, table, request_id):
    if table == "receipts":
        conn.execute(
            text("INSERT INTO receipts (number,request_id,created_by) VALUES (2,:r,:u)"),
            {**ids, "r": request_id},
        )
    else:
        conn.execute(
            text(
                "INSERT INTO stock_movements "
                "(product_id,warehouse_id,qty,kind,created_by,request_id) "
                "VALUES (:p,:w,1,'adjustment',:u,:r)"
            ),
            {**ids, "r": request_id},
        )


def test_upgrade_downgrade_with_legacy_data(migration_case):
    engine, migrate, _ = migration_case
    for direction, revision in [
        ("upgrade", REVISION),
        ("downgrade", PREVIOUS),
        ("upgrade", REVISION),
    ]:
        migrate(direction, revision)
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT count(*) FROM receipts")) == 1
            assert conn.scalar(text("SELECT sum(qty) FROM stock_movements")) == 5
            assert conn.scalar(text("SELECT version_num FROM alembic_version")) == revision
            if direction == "upgrade":
                assert conn.scalar(text("SELECT request_id FROM receipts")) is None
                assert conn.scalar(text("SELECT request_id FROM stock_movements")) is None
                inspector = inspect(conn)
                for table in ("receipts", "stock_movements"):
                    column = next(
                        c for c in inspector.get_columns(table) if c["name"] == "request_id"
                    )
                    assert column["nullable"] and str(column["type"]) == "UUID"
                assert any(
                    c["name"] == "uq_receipts_request_id"
                    for c in inspector.get_unique_constraints("receipts")
                )
                index = next(
                    i
                    for i in inspector.get_indexes("stock_movements")
                    if i["name"] == "uq_stock_movements_request_id"
                )
                assert index["unique"]
                assert "request_id IS NOT NULL" in index["dialect_options"]["postgresql_where"]
        for statement in (
            "UPDATE stock_movements SET qty=qty",
            "DELETE FROM stock_movements",
            "TRUNCATE stock_movements",
        ):
            with pytest.raises(DBAPIError, match="append-only"), engine.begin() as conn:
                conn.execute(text(statement))


@pytest.mark.parametrize("table", ["receipts", "stock_movements"])
def test_key_uniqueness_and_guarded_downgrade(migration_case, table):
    engine, migrate, ids = migration_case
    migrate("upgrade", REVISION)
    request_id = uuid.uuid4()
    with engine.begin() as conn:
        insert_keyed(conn, ids, table, request_id)
    with pytest.raises(IntegrityError, match=f"uq_{table}_request_id"), engine.begin() as conn:
        if table == "receipts":
            conn.execute(
                text("INSERT INTO receipts (number,request_id,created_by) VALUES (3,:r,:u)"),
                {**ids, "r": request_id},
            )
        else:
            insert_keyed(conn, ids, table, request_id)
    result = migrate("downgrade", PREVIOUS, check=False)
    assert result.returncode != 0
    assert "Откат миграции невозможен" in result.stderr
    assert "из резервной копии (deploy/restore.sh)" in result.stderr
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT version_num FROM alembic_version")) == REVISION
        assert conn.scalar(text(f"SELECT count(*) FROM {table} WHERE request_id IS NOT NULL")) == 1
        assert all(
            "request_id" in {c["name"] for c in inspect(conn).get_columns(t)}
            for t in ("receipts", "stock_movements")
        )
