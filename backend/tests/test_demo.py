from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import demo
from app.auth.models import User
from app.auth.service import verify_password
from app.catalog import service as catalog_service
from app.catalog.models import Product
from app.customers.models import Customer
from app.receipts.models import Receipt
from app.sales.models import Sale
from app.settings.service import get_business_settings


def test_demo_database_url_replaces_only_database_name() -> None:
    url = demo.demo_database_url("postgresql+psycopg://qoima:secret@127.0.0.1:5432/qoima")

    assert url == "postgresql+psycopg://qoima:secret@127.0.0.1:5432/qoima_demo"


def test_demo_database_url_refuses_demo_as_main_database() -> None:
    with pytest.raises(RuntimeError):
        demo.demo_database_url("postgresql+psycopg://qoima:secret@127.0.0.1:5432/qoima_demo")


def _stock(db: Session, article: str) -> int:
    product = db.execute(select(Product).where(Product.article == article)).scalar_one()
    return catalog_service.get_product(db, product.id).stock


def test_seed_fills_demo_data(db_session: Session) -> None:
    demo.seed(db_session, "demo-password", now=datetime(2026, 9, 27, 12, 0, tzinfo=UTC))

    user = db_session.execute(select(User).where(User.username == "demo")).scalar_one()
    assert user.locale == "kk"
    assert verify_password(user.password_hash, "demo-password")

    settings = get_business_settings(db_session)
    assert settings.seller_name == "3А Аuto Parts.KZ"
    assert settings.chief_accountant == "Қамтамасыз етілмейді"

    assert db_session.scalar(select(func.count()).select_from(Product)) == len(demo.PRODUCTS)
    archived = db_session.scalars(select(Product.article).where(Product.is_archived)).all()
    assert archived == ["04466-02070"]
    assert _stock(db_session, "22401-8H515") == 2
    assert _stock(db_session, "L3Y4-18-110") == 0

    assert db_session.scalar(select(func.count()).select_from(Customer)) == 6
    receipt = db_session.execute(select(Receipt)).scalar_one()
    assert receipt.supplier == "Бастапқы қалдық"

    statuses = db_session.scalars(select(Sale.status)).all()
    assert len(statuses) == len(demo.SALES)
    assert statuses.count("cancelled") == 1
    days = {sale.sold_at.date() for sale in db_session.scalars(select(Sale))}
    assert min(days) >= datetime(2026, 9, 17).date()
