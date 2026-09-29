"""Demo database for screenshots and manual checks, isolated from the working one.

Usage (from backend/):
  DEMO_PASSWORD=... uv run python -m app.demo seed   # recreate qoima_demo and fill it
  uv run python -m app.demo serve --port 8011        # run the API against qoima_demo

The demo database lives on the same server as DATABASE_URL, under the fixed name qoima_demo.
"""

import argparse
import os
import subprocess
import sys
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg
from sqlalchemy import create_engine, make_url
from sqlalchemy.orm import Session, sessionmaker

from app import models  # noqa: F401  (registers every model so cross-module FKs resolve)
from app.auth import service as auth_service
from app.catalog import service as catalog_service
from app.catalog.schemas import ProductCreate, ProductUpdate
from app.config import get_settings
from app.customers import service as customers_service
from app.customers.schemas import CustomerCreate
from app.receipts import service as receipts_service
from app.receipts.schemas import ReceiptCreate, ReceiptLineIn
from app.sales import service as sales_service
from app.sales.schemas import SaleCreate, SaleLineIn
from app.settings import service as settings_service
from app.settings.schemas import BusinessSettingsUpdate

DEMO_DB_NAME = "qoima_demo"
DEMO_USERNAME = "demo"
DEMO_PASSWORD_ENV = "DEMO_PASSWORD"
BACKEND_DIR = Path(__file__).resolve().parents[1]
LOCAL_TZ = ZoneInfo("Asia/Almaty")

# Fixed namespace: the same seed always produces the same request ids.
_REQUEST_NS = uuid.UUID("5d7c1d52-8a0e-4c1c-9d8f-3f7f6b1f0a16")


@dataclass(frozen=True)
class DemoProduct:
    article: str
    name: str
    brand: str | None
    price_tenge: int
    initial_qty: int  # 0: never received, stays out of stock
    archived: bool = False


PRODUCTS = [
    DemoProduct("12686362 41-157", "Свеча зажигания", "BMW", 1800, 24),
    DemoProduct("IKH16TT", "Свеча зажигания иридиевая", "Denso", 1500, 40),
    DemoProduct("IKH20TT", "Свеча зажигания иридиевая", "Denso", 1500, 36),
    DemoProduct("IXEH22TT", "Свеча зажигания иридиевая", "Denso", 1700, 20),
    DemoProduct("L3Y2-18-110", "Свеча зажигания", "Mazda", 1300, 30),
    DemoProduct("PE5R-18-110", "Свеча зажигания", "Mazda", 1400, 28),
    DemoProduct("22401-ED815", "Свеча зажигания", "Nissan", 1200, 32),
    DemoProduct("22401-8H515", "Свеча зажигания", "Nissan", 1250, 10),
    DemoProduct("L3Y4-18-110", "Свеча зажигания", "Mazda", 1350, 0),
    DemoProduct("15208-65F0E", "Фильтр масляный", "Nissan", 2400, 18),
    DemoProduct("90915-YZZE1", "Фильтр масляный", "Toyota", 2600, 22),
    DemoProduct("26300-35505", "Фильтр масляный", "Hyundai", 2200, 15),
    DemoProduct("17801-0H050", "Фильтр воздушный", "Toyota", 4800, 10),
    DemoProduct("28113-2S000", "Фильтр воздушный", "Hyundai", 4500, 8),
    DemoProduct("87139-0N010", "Фильтр салона", "Toyota", 3900, 12),
    DemoProduct("04465-33471", "Колодки тормозные передние", "Toyota", 16500, 6),
    DemoProduct("58101-2SA70", "Колодки тормозные передние", "Hyundai", 14800, 5),
    DemoProduct("D1060-JN00A", "Колодки тормозные передние", "Nissan", 15900, 4),
    DemoProduct("04466-02070", "Колодки тормозные задние", "Toyota", 12500, 3, archived=True),
]

CUSTOMERS = [
    ("Амангельды Серікбаев", "77012345678"),
    ("Нұрлан Қасымов", "77054441122"),
    ("Айгүл Әбенова", "77473339911"),
    ("Ерлан Төлеуов", "77780012233"),
    ("Бауыржан Жұмабеков", "77019876543"),
    ("Сәуле Мұхамедқызы", "77076665544"),
]

# (days ago, customer index or None, [(article, qty)]). The first is cancelled below.
SALES = [
    (9, 0, [("IKH16TT", 4), ("15208-65F0E", 1)]),
    (8, 1, [("22401-ED815", 4), ("22401-8H515", 4)]),
    (7, None, [("90915-YZZE1", 2)]),
    (6, 2, [("L3Y2-18-110", 4), ("17801-0H050", 1)]),
    (5, 3, [("04465-33471", 1), ("PE5R-18-110", 4)]),
    (4, 0, [("IXEH22TT", 4)]),
    (3, 4, [("22401-8H515", 4), ("26300-35505", 2)]),
    (1, 5, [("IKH20TT", 6), ("87139-0N010", 1)]),
    (0, 1, [("12686362 41-157", 4), ("58101-2SA70", 1)]),
]
CANCELLED_SALE_INDEX = 0
CANCEL_REASON = "Сатып алушы бас тартты"

BUSINESS_SETTINGS = BusinessSettingsUpdate(
    seller_name="3А Аuto Parts.KZ",
    seller_iin_bin="",
    responsible_person="Кәкеш Арман",
    released_by_name="Кәкеш А.",
    chief_accountant="Қамтамасыз етілмейді",
)


def demo_database_url(database_url: str) -> str:
    """DATABASE_URL with the database name replaced by qoima_demo."""
    url = make_url(database_url)
    if url.database == DEMO_DB_NAME:
        raise RuntimeError(f"DATABASE_URL уже указывает на {DEMO_DB_NAME}: нужна основная база")
    return url.set(database=DEMO_DB_NAME).render_as_string(hide_password=False)


def _libpq_url(database_url: str) -> str:
    return make_url(database_url).set(drivername="postgresql").render_as_string(hide_password=False)


def recreate_database(database_url: str) -> str:
    """Drop and create qoima_demo, apply migrations. Returns its URL."""
    demo_url = demo_database_url(database_url)
    with psycopg.connect(_libpq_url(database_url), autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{DEMO_DB_NAME}" WITH (FORCE)')
        conn.execute(f'CREATE DATABASE "{DEMO_DB_NAME}"')
    subprocess.run(
        ["uv", "run", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        env={**os.environ, "DATABASE_URL": demo_url},
        check=True,
    )
    return demo_url


def _sale_time(now: datetime, days_ago: int) -> datetime:
    """11:00 local time N days ago; today's sale never lands in the future."""
    local_day = now.astimezone(LOCAL_TZ).date() - timedelta(days=days_ago)
    moment = datetime.combine(local_day, time(11, 0), tzinfo=LOCAL_TZ)
    return min(moment, now - timedelta(minutes=1))


def seed(db: Session, password: str, now: datetime | None = None) -> None:
    """Fill an empty database with demo data through the regular services."""
    now = now or datetime.now(UTC)

    settings_service.update_business_settings(db, BUSINESS_SETTINGS)
    user = auth_service.create_user(db, DEMO_USERNAME, "Кәкеш Арман", password, locale="kk")

    product_ids: dict[str, int] = {}
    for item in PRODUCTS:
        product = catalog_service.create_product(
            db,
            ProductCreate(
                article=item.article,
                name=item.name,
                brand=item.brand,
                sale_price=item.price_tenge * 100,
            ),
        )
        product_ids[item.article] = product.id

    customer_ids = [
        customers_service.create_customer(db, CustomerCreate(name=name, phone=phone)).id
        for name, phone in CUSTOMERS
    ]

    receipts_service.post_receipt(
        db,
        ReceiptCreate(
            supplier="Бастапқы қалдық",
            note="Бастапқы қалдық",
            received_at=_sale_time(now, 11),
            lines=[
                ReceiptLineIn(product_id=product_ids[item.article], qty=item.initial_qty)
                for item in PRODUCTS
                if item.initial_qty > 0
            ],
        ),
        user.id,
    )

    sale_ids: list[int] = []
    for number, (days_ago, customer, lines) in enumerate(SALES):
        sale, _ = sales_service.post_sale(
            db,
            SaleCreate(
                request_id=uuid.uuid5(_REQUEST_NS, f"sale-{number}"),
                customer_id=customer_ids[customer] if customer is not None else None,
                sold_at=_sale_time(now, days_ago),
                lines=[
                    SaleLineIn(product_id=product_ids[article], qty=qty) for article, qty in lines
                ],
            ),
            user.id,
        )
        sale_ids.append(sale.id)
    sales_service.cancel_sale(db, sale_ids[CANCELLED_SALE_INDEX], CANCEL_REASON, user.id)

    for item in PRODUCTS:
        if item.archived:
            catalog_service.update_product(
                db, product_ids[item.article], ProductUpdate(is_archived=True)
            )


def _seed_command() -> int:
    password = os.environ.get(DEMO_PASSWORD_ENV, "")
    if not password:
        print(
            f"Задайте пароль пользователя demo в переменной {DEMO_PASSWORD_ENV}",
            file=sys.stderr,
        )
        return 1
    demo_url = recreate_database(get_settings().database_url)
    engine = create_engine(demo_url)
    try:
        with sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)() as db:
            seed(db, password)
    finally:
        engine.dispose()
    print(f"База {DEMO_DB_NAME} заполнена, пользователь «{DEMO_USERNAME}»")
    return 0


def _serve_command(port: int) -> int:
    # Replaces this process, so app.db builds its engine from the demo URL and stopping
    # the command stops the server.
    env = {**os.environ, "DATABASE_URL": demo_database_url(get_settings().database_url)}
    os.chdir(BACKEND_DIR)
    args = [sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port)]
    os.execve(sys.executable, args, env)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.demo", description="Демо-база qoima_demo")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("seed", help="пересоздать и заполнить qoima_demo")
    serve = commands.add_parser("serve", help="запустить API на qoima_demo")
    serve.add_argument("--port", type=int, default=8011)
    args = parser.parse_args(argv)
    if args.command == "seed":
        return _seed_command()
    return _serve_command(args.port)


if __name__ == "__main__":
    sys.exit(main())
