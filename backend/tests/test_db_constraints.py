import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from app.catalog.models import Product
from app.inventory.models import Warehouse
from app.inventory.service import MovementIn, post_movements
from app.numbering import next_number
from app.receipts.models import Receipt
from app.sales.models import Sale, SaleLine
from tests.factories import create_product, create_user


@pytest.fixture
def product_with_movement(db_session: Session) -> Product:
    user = create_user(db_session)
    product = create_product(db_session)
    post_movements(db_session, [MovementIn(product.id, 5, "receipt")], user.id)
    return product


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE stock_movements SET qty = 100",
        "DELETE FROM stock_movements",
        "TRUNCATE stock_movements",
    ],
)
def test_stock_movements_are_append_only(
    db_session: Session, product_with_movement: Product, statement: str
) -> None:
    with pytest.raises(DBAPIError, match="append-only"):
        with db_session.begin_nested():
            db_session.execute(text(statement))

    count = db_session.execute(text("SELECT count(*) FROM stock_movements")).scalar_one()
    assert count >= 1


def test_negative_balance_violates_check(
    db_session: Session, product_with_movement: Product
) -> None:
    with pytest.raises(IntegrityError, match="ck_stock_balances_qty_non_negative"):
        with db_session.begin_nested():
            db_session.execute(
                text("UPDATE stock_balances SET qty = -1 WHERE product_id = :id"),
                {"id": product_with_movement.id},
            )


def test_article_norm_is_unique(db_session: Session) -> None:
    create_product(db_session, article="OC-90")

    with pytest.raises(IntegrityError, match="uq_products_article_norm"):
        with db_session.begin_nested():
            create_product(db_session, article="ос 90")


def test_cancelled_status_requires_cancelled_at(db_session: Session) -> None:
    user = create_user(db_session)

    with pytest.raises(IntegrityError, match="ck_receipts_cancelled_consistent"):
        with db_session.begin_nested():
            db_session.add(
                Receipt(
                    number=next_number(db_session, "receipt"),
                    status="cancelled",
                    created_by=user.id,
                )
            )
            db_session.flush()


@pytest.fixture
def sale(db_session: Session) -> Sale:
    user = create_user(db_session)
    sale = Sale(
        number=next_number(db_session, "sale"),
        request_id=uuid.uuid4(),
        total=0,
        created_by=user.id,
    )
    db_session.add(sale)
    db_session.flush()
    return sale


def test_sale_line_total_must_match_qty_times_price(db_session: Session, sale: Sale) -> None:
    product = create_product(db_session)

    with pytest.raises(IntegrityError, match="ck_sale_lines_line_total_matches"):
        with db_session.begin_nested():
            db_session.add(
                SaleLine(
                    sale_id=sale.id, product_id=product.id, qty=3, unit_price=1500, line_total=4000
                )
            )
            db_session.flush()

    line = SaleLine(sale_id=sale.id, product_id=product.id, qty=3, unit_price=1500, line_total=4500)
    db_session.add(line)
    db_session.flush()
    assert line.id is not None


def test_main_warehouse_is_seeded(db_session: Session) -> None:
    warehouse = db_session.execute(select(Warehouse).where(Warehouse.code == "main")).scalar_one()
    assert warehouse.name == "Основной"


def test_document_number_is_required(db_session: Session) -> None:
    user = create_user(db_session)

    with pytest.raises(IntegrityError, match="number"):
        with db_session.begin_nested():
            db_session.add(Receipt(created_by=user.id))
            db_session.flush()


@pytest.mark.parametrize(
    ("statement", "constraint"),
    [
        (
            "INSERT INTO document_counters (doc_type, last_number) VALUES ('invoice', 0)",
            "ck_document_counters_doc_type_valid",
        ),
        (
            "UPDATE document_counters SET last_number = -1 WHERE doc_type = 'sale'",
            "ck_document_counters_last_number_non_negative",
        ),
        (
            "INSERT INTO document_counters (doc_type, last_number) VALUES ('sale', 0)",
            "pk_document_counters",
        ),
    ],
)
def test_document_counters_constraints(
    db_session: Session, statement: str, constraint: str
) -> None:
    with pytest.raises(IntegrityError, match=constraint):
        with db_session.begin_nested():
            db_session.execute(text(statement))


def test_business_settings_has_single_row(db_session: Session) -> None:
    count = db_session.execute(text("SELECT count(*) FROM business_settings")).scalar_one()
    assert count == 1

    with pytest.raises(IntegrityError, match="ck_business_settings_single_row"):
        with db_session.begin_nested():
            db_session.execute(text("INSERT INTO business_settings (id) VALUES (2)"))
