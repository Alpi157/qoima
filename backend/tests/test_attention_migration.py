import os
import subprocess
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from tests.conftest import BACKEND_DIR, test_engine

PREVIOUS = "c8a5e3921029"
REVISION = "d9b6f4031030"


@pytest.fixture
def migration_case():
    schema = "attention_migration_" + uuid.uuid4().hex
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


def test_upgrade_and_empty_downgrade(migration_case):
    engine, migrate, _ = migration_case
    for direction, target in [
        ("upgrade", REVISION),
        ("downgrade", PREVIOUS),
        ("upgrade", REVISION),
    ]:
        migrate(direction, target)
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT version_num FROM alembic_version")) == target
            if direction == "upgrade":
                assert tuple(
                    conn.execute(
                        text(
                            "SELECT opening_balance_date, attention_markup_drop_points, "
                            "attention_debt_days, attention_frozen_days, attention_runway_days, "
                            "attention_discount_percent, attention_loss_percent "
                            "FROM business_settings"
                        )
                    ).one()
                ) == (None, 10, 30, 90, 30, 10, 2)


@pytest.mark.parametrize("reason", ["dismissal", "opening"])
def test_downgrade_refuses_atomically(migration_case, reason):
    engine, migrate, ids = migration_case
    migrate("upgrade", REVISION)
    with engine.begin() as conn:
        if reason == "dismissal":
            conn.execute(
                text(
                    "INSERT INTO attention_dismissals (key,hidden_until,created_by) "
                    "VALUES ('discounts:business',CURRENT_DATE,:user)"
                ),
                ids,
            )
        else:
            conn.execute(text("UPDATE business_settings SET opening_balance_date=CURRENT_DATE"))
    result = migrate("downgrade", PREVIOUS, check=False)
    assert result.returncode != 0
    assert "Откат миграции невозможен" in result.stderr
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT version_num FROM alembic_version")) == REVISION
        assert conn.scalar(text("SELECT attention_debt_days FROM business_settings")) == 30


@pytest.mark.parametrize(
    "field,low,high",
    [
        ("markup_drop_points", 1, 100),
        ("debt_days", 1, 365),
        ("frozen_days", 30, 365),
        ("runway_days", 1, 180),
        ("discount_percent", 1, 100),
        ("loss_percent", 1, 100),
    ],
)
def test_threshold_constraints(migration_case, field, low, high):
    engine, migrate, _ = migration_case
    migrate("upgrade", REVISION)
    for value in (low - 1, high + 1):
        with pytest.raises(IntegrityError), engine.begin() as conn:
            conn.execute(
                text(f"UPDATE business_settings SET attention_{field}=:value"), {"value": value}
            )
