import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from tests.test_receipt_currency_migration import migration_case as migration_case


def test_receipt_threshold_upgrade_check_and_downgrade(migration_case):
    engine, migrate, _ = migration_case
    migrate("upgrade", "9b5e3c841026")
    with engine.connect() as db:
        before = db.execute(text("SELECT * FROM business_settings")).all()
    migrate("upgrade", "ac6d7e921026")
    with engine.connect() as db:
        assert db.scalar(text("SELECT rate_warning_percent FROM business_settings")) == 10
    for value in (1, 100):
        with engine.begin() as db:
            db.execute(text("UPDATE business_settings SET rate_warning_percent=:v"), {"v": value})
    for value in (0, 101):
        with pytest.raises(IntegrityError), engine.begin() as db:
            db.execute(text("UPDATE business_settings SET rate_warning_percent=:v"), {"v": value})
    migrate("downgrade", "9b5e3c841026")
    with engine.connect() as db:
        assert "rate_warning_percent" not in {
            c["name"] for c in inspect(db).get_columns("business_settings")
        }
        assert db.execute(text("SELECT * FROM business_settings")).all() == before
