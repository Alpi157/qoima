import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import InsufficientStockError
from app.inventory.models import StockBalance, StockMovement, Warehouse
from app.inventory.service import MovementIn, post_movements
from tests.factories import create_product, create_user


def _balance(db: Session, product_id: int) -> int:
    return db.execute(
        select(StockBalance.qty).where(StockBalance.product_id == product_id)
    ).scalar_one()


def _movement_count(db: Session, product_id: int) -> int:
    query = select(func.count()).where(StockMovement.product_id == product_id)
    return db.execute(query).scalar_one()


def test_receipt_increases_balance(db_session: Session) -> None:
    user = create_user(db_session)
    product = create_product(db_session)

    created = post_movements(db_session, [MovementIn(product.id, 5, "receipt")], user.id)

    assert _balance(db_session, product.id) == 5
    assert len(created) == 1
    assert created[0].id is not None
    assert created[0].created_by == user.id


def test_sale_decreases_balance(db_session: Session) -> None:
    user = create_user(db_session)
    product = create_product(db_session)
    post_movements(db_session, [MovementIn(product.id, 5, "receipt")], user.id)

    post_movements(db_session, [MovementIn(product.id, -3, "sale")], user.id)

    assert _balance(db_session, product.id) == 2
    assert _movement_count(db_session, product.id) == 2


def test_multiple_movements_of_same_product_are_summed(db_session: Session) -> None:
    user = create_user(db_session)
    product = create_product(db_session)

    post_movements(
        db_session,
        [
            MovementIn(product.id, 4, "receipt"),
            MovementIn(product.id, 6, "receipt"),
            MovementIn(product.id, -7, "sale"),
        ],
        user.id,
    )

    assert _balance(db_session, product.id) == 3
    assert _movement_count(db_session, product.id) == 3


def test_movement_within_one_call_can_use_stock_from_same_call(db_session: Session) -> None:
    user = create_user(db_session)
    product = create_product(db_session)

    post_movements(
        db_session,
        [MovementIn(product.id, -2, "sale"), MovementIn(product.id, 2, "receipt")],
        user.id,
    )

    assert _balance(db_session, product.id) == 0


def test_default_warehouse_is_main(db_session: Session) -> None:
    user = create_user(db_session)
    product = create_product(db_session)

    [movement] = post_movements(db_session, [MovementIn(product.id, 1, "receipt")], user.id)

    main = db_session.execute(select(Warehouse).where(Warehouse.code == "main")).scalar_one()
    assert movement.warehouse_id == main.id


def test_going_negative_raises_and_writes_nothing(db_session: Session) -> None:
    user = create_user(db_session)
    product = create_product(db_session, article="ос-90")
    post_movements(db_session, [MovementIn(product.id, 2, "receipt")], user.id)

    with pytest.raises(InsufficientStockError) as exc_info:
        post_movements(db_session, [MovementIn(product.id, -3, "sale")], user.id)

    assert "ос-90: на остатке 2, требуется 3" in exc_info.value.message
    assert _balance(db_session, product.id) == 2
    assert _movement_count(db_session, product.id) == 1


def test_error_lists_all_short_products_and_writes_nothing(db_session: Session) -> None:
    user = create_user(db_session)
    ok = create_product(db_session, article="OK-1")
    short_a = create_product(db_session, article="OC90")
    short_b = create_product(db_session, article="W712")
    post_movements(db_session, [MovementIn(ok.id, 10, "receipt")], user.id)

    with pytest.raises(InsufficientStockError) as exc_info:
        post_movements(
            db_session,
            [
                MovementIn(ok.id, -1, "sale"),
                MovementIn(short_a.id, -3, "sale"),
                MovementIn(short_b.id, -1, "sale"),
            ],
            user.id,
        )

    message = exc_info.value.message
    assert "OC90: на остатке 0, требуется 3" in message
    assert "W712: на остатке 0, требуется 1" in message
    assert "OK-1" not in message
    assert _balance(db_session, ok.id) == 10
    assert _movement_count(db_session, ok.id) == 1
    assert _movement_count(db_session, short_a.id) == 0


@pytest.mark.parametrize(
    ("qty", "kind"),
    [(0, "receipt"), (1, "gift"), (True, "receipt")],
)
def test_invalid_movement_raises_value_error(db_session: Session, qty: int, kind: str) -> None:
    user = create_user(db_session)
    product = create_product(db_session)

    with pytest.raises(ValueError):
        post_movements(db_session, [MovementIn(product.id, qty, kind)], user.id)


def test_empty_movements_is_noop(db_session: Session) -> None:
    user = create_user(db_session)
    assert post_movements(db_session, [], user.id) == []
