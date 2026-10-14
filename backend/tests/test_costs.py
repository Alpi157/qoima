import inspect
import uuid

import pytest
from sqlalchemy import select

from app.inventory.models import StockBalance, StockMovement
from app.inventory.service import MovementIn, post_movements, round_half_up
from app.receipts.schemas import ReceiptCreate, ReceiptLineIn
from app.receipts.service import cancel_receipt, post_receipt
from app.sales.schemas import SaleCreate, SaleLineIn
from app.sales.service import cancel_sale, get_sale, post_sale
from tests.factories import create_product, create_user


@pytest.mark.parametrize(
    ("numerator", "denominator", "expected"),
    [
        (0, 3, 0),
        (1, 2, 1),
        (5, 2, 3),
        (4, 3, 1),
        (5, 3, 2),
        (2**100 + 1, 2, 2**99 + 1),
        (10**50 * 7 + 3, 7, 10**50),
    ],
)
def test_round_half_up(numerator, denominator, expected):
    assert round_half_up(numerator, denominator) == expected
    assert isinstance(round_half_up(numerator, denominator), int)
    assert "/" not in inspect.getsource(round_half_up).replace("//", "")


@pytest.mark.parametrize(
    ("numerator", "denominator"), [(-1, 1), (1, 0), (1, -1), (1.0, 2), (1, 2.0), (True, 2)]
)
def test_round_invalid_arguments(numerator, denominator):
    with pytest.raises(ValueError):
        round_half_up(numerator, denominator)


@pytest.fixture
def stock_case(db_session):
    user = create_user(db_session)
    product = create_product(db_session, sale_price=500)
    return product.id, user.id


def balance(db, product_id):
    return db.scalar(select(StockBalance).where(StockBalance.product_id == product_id))


def move(db, case, qty, kind, cost=None):
    product_id, user_id = case
    return post_movements(db, [MovementIn(product_id, qty, kind, unit_cost=cost)], user_id)[0]


def test_average_receipts_and_zero_stock(db_session, stock_case):
    first = move(db_session, stock_case, 3, "receipt", 100)
    assert first.unit_cost == 100
    second = move(db_session, stock_case, 2, "receipt", 201)
    b = balance(db_session, stock_case[0])
    assert (b.qty, b.avg_cost, second.unit_cost) == (5, 140, 201)
    sale = move(db_session, stock_case, -5, "sale", 999)
    assert (b.qty, b.avg_cost, sale.unit_cost) == (0, 140, 140)
    move(db_session, stock_case, 1, "receipt", 50)
    assert (b.qty, b.avg_cost) == (1, 50)


def test_ordered_movements_and_unknown_receipt(db_session, stock_case):
    product_id, user_id = stock_case
    rows = post_movements(
        db_session,
        [
            MovementIn(product_id, 1, "receipt", unit_cost=100),
            MovementIn(product_id, 1, "receipt", unit_cost=101),
            MovementIn(product_id, -1, "sale"),
            MovementIn(product_id, 2, "receipt"),
            MovementIn(product_id, 1, "adjustment", unit_cost=999),
            MovementIn(product_id, -1, "adjustment", unit_cost=999),
        ],
        user_id,
    )
    assert [row.unit_cost for row in rows] == [100, 101, 101, 101, 101, 101]
    b = balance(db_session, product_id)
    assert (b.qty, b.avg_cost) == (3, 101)


def test_unknown_average_until_first_known_receipt(db_session, stock_case):
    assert move(db_session, stock_case, 5, "receipt").unit_cost is None
    assert move(db_session, stock_case, -1, "sale").unit_cost is None
    assert move(db_session, stock_case, 1, "adjustment").unit_cost is None
    move(db_session, stock_case, 2, "receipt", 200)
    assert balance(db_session, stock_case[0]).avg_cost == 200


@pytest.mark.parametrize(("sold", "remaining", "expected"), [(0, 4, 100), (4, 0, 150), (3, 1, 150)])
def test_receipt_cancel_normal_zero_and_negative_numerator(
    db_session, stock_case, sold, remaining, expected
):
    move(db_session, stock_case, 4, "receipt", 100)
    move(db_session, stock_case, 4, "receipt", 200)
    if sold:
        move(db_session, stock_case, -sold, "sale")
    result = move(db_session, stock_case, -4, "receipt_cancel", 200)
    b = balance(db_session, stock_case[0])
    assert (b.qty, b.avg_cost, result.unit_cost) == (remaining, expected, 200)


def test_unknown_receipt_cancel_keeps_average(db_session, stock_case):
    move(db_session, stock_case, 3, "receipt")
    move(db_session, stock_case, -1, "receipt_cancel", 100)
    assert balance(db_session, stock_case[0]).avg_cost is None
    move(db_session, stock_case, 1, "receipt", 200)
    cancelled = move(db_session, stock_case, -1, "receipt_cancel")
    assert cancelled.unit_cost == 200
    assert balance(db_session, stock_case[0]).avg_cost == 200


def test_sale_snapshot_and_historical_return(db_session, stock_case):
    product_id, user_id = stock_case
    receipt, _ = post_receipt(
        db_session,
        ReceiptCreate(
            request_id=uuid.uuid4(),
            lines=[ReceiptLineIn(product_id=product_id, qty=4, unit_cost=100)],
        ),
        user_id,
    )
    sale, _ = post_sale(
        db_session,
        SaleCreate(
            request_id=uuid.uuid4(),
            lines=[SaleLineIn(product_id=product_id, qty=2, unit_price=500)],
        ),
        user_id,
    )
    assert sale.lines[0].unit_cost == 100
    assert balance(db_session, product_id).avg_cost == 100
    post_receipt(
        db_session,
        ReceiptCreate(
            request_id=uuid.uuid4(),
            lines=[ReceiptLineIn(product_id=product_id, qty=2, unit_cost=300)],
        ),
        user_id,
    )
    assert balance(db_session, product_id).avg_cost == 200
    cancelled = cancel_sale(db_session, sale.id, "Ошибка продажи", user_id)
    assert cancelled.lines[0].unit_cost == 100
    b = balance(db_session, product_id)
    assert (b.qty, b.avg_cost) == (6, 167)
    assert get_sale(db_session, sale.id).lines[0].unit_cost == 100
    movement = db_session.scalar(
        select(StockMovement).where(
            StockMovement.kind == "sale_cancel", StockMovement.doc_id == sale.id
        )
    )
    assert movement.unit_cost == 100
    cancel_receipt(db_session, receipt.id, "Ошибка прихода", user_id)
    assert b.avg_cost == 301


@pytest.mark.parametrize("cost", [-1, True, 1.5, "100"])
def test_invalid_movement_cost(db_session, stock_case, cost):
    with pytest.raises(ValueError):
        move(db_session, stock_case, 1, "receipt", cost)


def test_large_costs_preserve_integer_precision(db_session, stock_case):
    high = 2**53 + 1
    move(db_session, stock_case, 10000, "receipt", high)
    move(db_session, stock_case, 10000, "receipt", high + 1)
    assert balance(db_session, stock_case[0]).avg_cost == high + 1


def test_unknown_sale_snapshot_and_cancel(db_session, stock_case):
    product_id, user_id = stock_case
    move(db_session, stock_case, 3, "adjustment")
    sale, _ = post_sale(
        db_session,
        SaleCreate(
            request_id=uuid.uuid4(),
            lines=[SaleLineIn(product_id=product_id, qty=1, unit_price=500)],
        ),
        user_id,
    )
    assert sale.lines[0].unit_cost is None
    cancelled = cancel_sale(db_session, sale.id, "Ошибка", user_id)
    assert cancelled.lines[0].unit_cost is None
    assert balance(db_session, product_id).avg_cost is None


def test_negative_cost_database_checks(db_session, stock_case):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    product_id, user_id = stock_case
    move(db_session, stock_case, 1, "receipt", 100)
    for statement, values in [
        ("UPDATE stock_balances SET avg_cost=-1 WHERE product_id=:p", {"p": product_id}),
        ("UPDATE products SET min_qty=-1 WHERE id=:p", {"p": product_id}),
        (
            "INSERT INTO stock_movements (product_id,warehouse_id,qty,kind,unit_cost,created_by) "
            "VALUES (:p,(SELECT id FROM warehouses WHERE code='main'),1,'receipt',-1,:u)",
            {"p": product_id, "u": user_id},
        ),
    ]:
        with pytest.raises(IntegrityError), db_session.begin_nested():
            db_session.execute(text(statement), values)
