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
from app.inventory.schemas import AdjustmentCreate
from app.inventory.service import create_adjustment
from app.payments import service as payments_service
from app.payments.schemas import PaymentCreate
from app.receipts import service as receipts_service
from app.receipts.schemas import ReceiptCreate, ReceiptLineIn
from app.returns import service as returns_service
from app.returns.schemas import ReturnCreate, ReturnLineIn
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
    min_qty: int | None = None


PRODUCTS = [
    DemoProduct("12686362 41-157", "Свеча зажигания", "BMW", 1800, 24),
    DemoProduct("IKH16TT", "Свеча зажигания иридиевая", "Denso", 1500, 40, min_qty=10),
    DemoProduct("IKH20TT", "Свеча зажигания иридиевая", "Denso", 1500, 36),
    DemoProduct("IXEH22TT", "Свеча зажигания иридиевая", "Denso", 1700, 20),
    DemoProduct("L3Y2-18-110", "Свеча зажигания", "Mazda", 1300, 30),
    DemoProduct("PE5R-18-110", "Свеча зажигания", "Mazda", 1400, 28),
    DemoProduct("22401-ED815", "Свеча зажигания", "Nissan", 1200, 32),
    DemoProduct("22401-8H515", "Свеча зажигания", "Nissan", 1250, 10, min_qty=3),
    DemoProduct("L3Y4-18-110", "Свеча зажигания", "Mazda", 1350, 0, min_qty=5),
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
    ("Дәурен Оспанов", "77024447788"),
    ("Жанар Ахметова", "77752223344"),
    ("Марат Ибраев", "77018889900"),
    ("Гүлнар Сейітова", "77475556677"),
]

# Sales over the last ten days in working hours (9:00-19:00 local time), to different
# customers, two of them today in the morning so they exist whenever the seed runs:
# (days ago, (hour, minute), customer index or None, [(article, qty)]).
# The first is cancelled below.
SALES = [
    (9, (10, 20), 0, [("IKH16TT", 4), ("15208-65F0E", 1)]),
    (8, (12, 5), 1, [("22401-ED815", 4), ("22401-8H515", 4)]),
    (7, (15, 40), None, [("90915-YZZE1", 2)]),
    (6, (9, 50), 2, [("L3Y2-18-110", 4), ("17801-0H050", 1)]),
    (5, (17, 30), 3, [("04465-33471", 1), ("PE5R-18-110", 4)]),
    (4, (11, 15), 6, [("IXEH22TT", 4)]),
    (3, (13, 45), 4, [("22401-8H515", 4), ("26300-35505", 2)]),
    (2, (16, 10), 7, [("IKH16TT", 2), ("87139-0N010", 1)]),
    (2, (18, 25), 8, [("90915-YZZE1", 1)]),
    (1, (10, 5), 5, [("IKH20TT", 6), ("87139-0N010", 1)]),
    (1, (14, 30), 9, [("28113-2S000", 1)]),
    (0, (9, 15), 0, [("12686362 41-157", 4), ("58101-2SA70", 1)]),
    (0, (10, 40), 3, [("IKH20TT", 2)]),
    (4, (15, 10), 1, [("IKH16TT", 1), ("15208-65F0E", 1), ("90915-YZZE1", 1)]),
    (
        3,
        (16, 20),
        2,
        [
            (item.article, 1)
            for item in PRODUCTS
            if item.initial_qty > 0 and not item.archived and item.article != "22401-8H515"
        ][:11]
        + [("04465-33471", 1)],
    ),
    (6, (10, 30), 1, [("IXEH22TT", 1)]),
]

# Deliveries after the opening balance:
# (days ago, (hour, minute), supplier, [(article, qty, unit cost in tenge)]).
RECEIPTS = [
    (8, (9, 30), "«Автоимпорт» ЖШС", [("IKH16TT", 10, 900), ("15208-65F0E", 6, 1400)]),
    (5, (16, 45), "«Жапон Авто» ЖШС", [("04465-33471", 4, 9600), ("58101-2SA70", 3, 8600)]),
    (2, (11, 20), "«Автоимпорт» ЖШС", [("90915-YZZE1", 10, 1500), ("26300-35505", 6, 1250)]),
]
UNKNOWN_COST_ARTICLE = "28113-2S000"
OPENING_SUPPLIER = "Бастапқы қалдық"
OPENING_TIME = (11, (9, 0))

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


def _local_time(now: datetime, days_ago: int, at: tuple[int, int]) -> datetime:
    """Local time of day N days ago; a moment later than now is moved to a minute ago."""
    local_day = now.astimezone(LOCAL_TZ).date() - timedelta(days=days_ago)
    moment = datetime.combine(local_day, time(*at), tzinfo=LOCAL_TZ)
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
                min_qty=item.min_qty,
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
            supplier=OPENING_SUPPLIER,
            note=OPENING_SUPPLIER,
            received_at=_local_time(now, *OPENING_TIME),
            lines=[
                ReceiptLineIn(
                    product_id=product_ids[item.article],
                    qty=item.initial_qty,
                    unit_cost=item.price_tenge * 55,
                )
                for item in PRODUCTS
                if item.initial_qty > 0 and item.article != UNKNOWN_COST_ARTICLE
            ],
        ),
        user.id,
    )

    unknown = next(item for item in PRODUCTS if item.article == UNKNOWN_COST_ARTICLE)
    create_adjustment(
        db,
        AdjustmentCreate(
            product_id=product_ids[unknown.article],
            qty=unknown.initial_qty,
            reason="Начальные остатки без закупочной цены",
        ),
        user.id,
    )

    for days_ago, at, supplier, receipt_lines in RECEIPTS:
        receipts_service.post_receipt(
            db,
            ReceiptCreate(
                supplier=supplier,
                received_at=_local_time(now, days_ago, at),
                lines=[
                    ReceiptLineIn(product_id=product_ids[article], qty=qty, unit_cost=cost * 100)
                    for article, qty, cost in receipt_lines
                ],
            ),
            user.id,
        )

    sale_ids: list[int] = []
    debt_sale_indices = {0, 1, 4, 6, 15}
    for number, (days_ago, at, customer, lines) in enumerate(SALES):
        sale, _ = sales_service.post_sale(
            db,
            SaleCreate(
                request_id=uuid.uuid5(_REQUEST_NS, f"sale-{number}"),
                customer_id=customer_ids[customer] if customer is not None else None,
                paid_amount=(
                    0
                    if number == 15
                    else sum(
                        next(item.price_tenge for item in PRODUCTS if item.article == article)
                        * qty
                        * 100
                        for article, qty in lines
                    )
                    // 2
                    if number in debt_sale_indices
                    else None
                ),
                payment_method=("card" if number % 2 else "cash") if number != 15 else None,
                sold_at=_local_time(now, days_ago, at),
                lines=[
                    SaleLineIn(product_id=product_ids[article], qty=qty) for article, qty in lines
                ],
            ),
            user.id,
        )
        sale_ids.append(sale.id)
    for number, amount in ((0, 100_000), (4, 100_000), (6, 50_000)):
        payment, _ = payments_service.post_payment(
            db,
            PaymentCreate(
                request_id=uuid.uuid5(_REQUEST_NS, f"payment-{number}"),
                customer_id=customer_ids[SALES[number][2]],
                amount=amount,
                payment_method="card" if number == 4 else "cash",
                paid_at=_local_time(now, 1, (16, 30)),
            ),
            user.id,
        )
        if number == 6:
            payments_service.cancel_payment(db, payment.id, "Қате төлем", user.id)
    sales_service.cancel_sale(db, sale_ids[CANCELLED_SALE_INDEX], CANCEL_REASON, user.id)

    # Preserve debt, low-stock and print examples while showing every return scenario.
    return_examples = [
        (9, "IKH20TT", 1, "good", None, "Ішінара қайтару"),
        (3, "L3Y2-18-110", 1, "defective", None, "Ақаулы тауар"),
        (4, "PE5R-18-110", 1, "good", None, "Қарызды азайту"),
        (5, "IXEH22TT", 1, "good", "card", "Картаға қайтару"),
        (2, "90915-YZZE1", 2, "good", "cash", "Сатып алушысыз толық қайтару"),
        (8, "90915-YZZE1", 1, "good", "cash", "Қате қайтару"),
    ]
    for index, (sale_index, article, qty, condition, method, note) in enumerate(return_examples):
        sale = sales_service.get_sale(db, sale_ids[sale_index])
        line = next(line for line in sale.lines if line.article == article)
        document, _ = returns_service.post_return(
            db,
            ReturnCreate(
                request_id=uuid.uuid5(_REQUEST_NS, f"return-{index}"),
                sale_id=sale.id,
                returned_at=min(sale.sold_at + timedelta(hours=2), now - timedelta(minutes=1)),
                note=note,
                refund_method=method,
                lines=[ReturnLineIn(sale_line_id=line.id, qty=qty, condition=condition)],
            ),
            user.id,
        )
        if index == 5:
            returns_service.cancel_return(db, document.id, "Қате қайтару", user.id)

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
