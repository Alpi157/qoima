from datetime import UTC, date, datetime, time

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import demo
from app.auth.models import User
from app.auth.service import verify_password
from app.catalog import service as catalog_service
from app.catalog.models import Product
from app.customers.models import Customer
from app.customers.service import current_debt
from app.inventory.service import stock_summary
from app.payments.models import CustomerPayment
from app.rates.models import ExchangeRate
from app.receipts.models import Receipt, ReceiptLine
from app.returns.models import SaleReturn, SaleReturnLine
from app.sales.models import Sale, SaleLine
from app.sales.service import list_sales
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

    assert db_session.scalar(select(func.count()).select_from(Customer)) == len(demo.CUSTOMERS)
    receipts = db_session.scalars(select(Receipt).order_by(Receipt.received_at)).all()
    assert len(receipts) == len(demo.RECEIPTS) + 2
    assert receipts[0].supplier == "Бастапқы қалдық"

    statuses = db_session.scalars(select(Sale.status)).all()
    assert len(statuses) == len(demo.SALES)
    assert statuses.count("cancelled") == 1
    sales = db_session.scalars(select(Sale)).all()
    assert all(sale.seller_name == settings.seller_name for sale in sales)
    for model in (SaleLine, ReceiptLine, SaleReturnLine):
        for line in db_session.scalars(select(model)):
            product = db_session.get(Product, line.product_id)
            assert (line.article, line.name, line.unit) == (
                product.article,
                product.name,
                product.unit,
            )
            if isinstance(line, SaleLine):
                assert line.list_price == product.sale_price
    assert {
        count
        for _, count in db_session.execute(
            select(SaleLine.sale_id, func.count()).group_by(SaleLine.sale_id)
        )
    } >= {3, 12}
    assert min(sale.sold_at for sale in sales) > receipts[0].received_at
    local_times = [sale.sold_at.astimezone(demo.LOCAL_TZ) for sale in sales]
    assert min(moment.date() for moment in local_times) >= date(2026, 9, 18)
    assert all(time(9) <= moment.time() <= time(19) for moment in local_times)
    today = [moment for moment in local_times if moment.date() == date(2026, 9, 27)]
    assert 1 <= len(today) <= 2
    customers = [sale.customer_id for sale in sales if sale.customer_id is not None]
    assert len(set(customers)) >= 8
    debts = [
        current_debt(db_session, customer.id) for customer in db_session.scalars(select(Customer))
    ]
    assert sum(debt > 0 for debt in debts) == 3
    assert sum(debt < 0 for debt in debts) == 1
    payments = db_session.scalars(select(CustomerPayment)).all()
    assert len(payments) == 3
    assert sum(payment.status == "cancelled" for payment in payments) == 1
    assert {payment.payment_method for payment in payments} == {"cash", "card"}
    assert {sale.payment_method for sale in sales} == {"cash", "card", None}
    returns = db_session.scalars(select(SaleReturn)).all()
    assert len(returns) == 6
    assert sum(document.status == "cancelled" for document in returns) == 1
    assert any(document.debt_credit > 0 and document.refund_amount == 0 for document in returns)
    assert any(
        document.refund_method == "card" and document.debt_credit == 0 for document in returns
    )
    assert any(
        document.customer_id is None and document.refund_method == "cash" for document in returns
    )
    assert {line.condition for line in db_session.scalars(select(SaleReturnLine))} == {
        "good",
        "defective",
    }
    page = list_sales(db_session, None, None, None, "posted", 200, 0)
    assert {item.payment_status for item in page.items} == {"paid", "partial", "unpaid", "returned"}
    for customer in db_session.scalars(select(Customer)):
        invoices = list_sales(db_session, None, None, customer.id, "posted", 200, 0).items
        assert sum(item.outstanding for item in invoices) == max(
            current_debt(db_session, customer.id), 0
        )
    for line, price in db_session.execute(
        select(ReceiptLine, Product.sale_price).join(Product, Product.id == ReceiptLine.product_id)
    ):
        assert line.unit_cost is not None
        assert price * 55 <= line.unit_cost * 100 <= price * 60
    unknown = db_session.scalar(select(Product).where(Product.article == demo.UNKNOWN_COST_ARTICLE))
    assert catalog_service.get_product(db_session, unknown.id).avg_cost is None
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(SaleLine)
            .join(Sale)
            .where(Sale.status == "posted", SaleLine.unit_cost.is_(None))
        )
        > 0
    )
    summary = stock_summary(db_session)
    assert summary.low_stock_count >= 1
    assert summary.out_of_stock_count >= 1
    assert summary.unknown_cost_count == 1
    changing = db_session.scalar(select(Product).where(Product.article == "IKH16TT"))
    assert catalog_service.get_product(db_session, changing.id).avg_cost == 84000


def test_seed_before_opening_hours_keeps_sales_in_the_past(db_session: Session) -> None:
    now = datetime(2026, 9, 27, 3, 0, tzinfo=UTC)  # 8:00 in Almaty
    demo.seed(db_session, "demo-password", now=now)

    assert max(db_session.scalars(select(Sale.sold_at))) < now


def test_demo_rates_cover_31_days_and_currency_receipt_is_exact(db_session):
    now = datetime(2026, 9, 27, 22, 0, tzinfo=UTC)
    demo.seed(db_session, "demo-password", now=now)
    rates = db_session.scalars(select(ExchangeRate)).all()
    assert len(rates) == 62
    assert min(rate.rate_date for rate in rates) == date(2026, 8, 29)
    assert max(rate.rate_date for rate in rates) == date(2026, 9, 28)
    assert all(rate.rate == demo.DEMO_RATES[rate.currency] for rate in rates)
    receipt = db_session.scalar(select(Receipt).where(Receipt.currency == "CNY"))
    from app.receipts.service import get_receipt

    saved = get_receipt(db_session, receipt.id)
    assert (saved.goods_total, saved.expenses_total, saved.total_cost) == (
        101430000,
        15750000,
        117180000,
    )
    assert [line.unit_cost for line in saved.lines] == [781200, 195300]


def test_demo_serve_forces_closed_local_feed(monkeypatch):
    from types import SimpleNamespace

    monkeypatch.setattr(
        demo,
        "get_settings",
        lambda: SimpleNamespace(database_url="postgresql+psycopg://demo:local@localhost/qoima"),
    )
    monkeypatch.setenv("NBK_RATES_URL", "https://example.invalid/feed")
    monkeypatch.setattr(demo.os, "chdir", lambda _: None)
    captured = {}
    monkeypatch.setattr(demo.os, "execve", lambda binary, args, env: captured.update(env))
    demo._serve_command(8011)
    assert captured["NBK_RATES_URL"] == "http://127.0.0.1:9/nbk"
    assert captured["DATABASE_URL"].endswith("/qoima_demo")
