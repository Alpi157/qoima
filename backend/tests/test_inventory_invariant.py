import random

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import InsufficientStockError
from app.inventory.models import StockBalance, StockMovement
from app.inventory.service import MovementIn, post_movements
from tests.factories import create_product, create_user


def test_balance_equals_sum_of_movements(db_session: Session) -> None:
    rng = random.Random(20260927)
    user = create_user(db_session)
    products = [create_product(db_session) for _ in range(3)]

    succeeded = failed = 0
    for _ in range(50):
        batch = []
        for _ in range(rng.randint(1, 2)):
            qty = rng.choice([q for q in range(-6, 6) if q != 0])
            kind = "receipt" if qty > 0 else "sale"
            batch.append(MovementIn(rng.choice(products).id, qty, kind))
        try:
            with db_session.begin_nested():
                post_movements(db_session, batch, user.id)
            succeeded += 1
        except InsufficientStockError:
            failed += 1

    assert succeeded > 0
    assert failed > 0

    for product in products:
        balance = db_session.execute(
            select(StockBalance.qty).where(StockBalance.product_id == product.id)
        ).scalar_one()
        movements_sum = db_session.execute(
            select(func.coalesce(func.sum(StockMovement.qty), 0)).where(
                StockMovement.product_id == product.id
            )
        ).scalar_one()
        assert balance == movements_sum
        assert balance >= 0
