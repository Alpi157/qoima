from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import Select, and_, func, select, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.auth.models import User
from app.catalog.models import Product
from app.errors import InsufficientStockError, ProductNotFoundError
from app.inventory.models import (
    MAIN_WAREHOUSE_CODE,
    MOVEMENT_KINDS,
    StockBalance,
    StockMovement,
    Warehouse,
)
from app.inventory.schemas import AdjustmentCreate, AdjustmentOut, MovementOut, MovementPage
from app.receipts.models import Receipt
from app.sales.models import Sale


@dataclass(frozen=True)
class MovementIn:
    product_id: int
    qty: int
    kind: str
    doc_type: str | None = None
    doc_id: int | None = None
    note: str | None = None
    warehouse_id: int | None = None


def post_movements(
    db: Session, movements: Sequence[MovementIn], user_id: int
) -> list[StockMovement]:
    """Record movements and update balances. Never commits: the caller owns the transaction."""
    if not movements:
        return []

    for m in movements:
        if isinstance(m.qty, bool) or not isinstance(m.qty, int) or m.qty == 0:
            raise ValueError(f"Movement qty must be a non-zero int, got {m.qty!r}")
        if m.kind not in MOVEMENT_KINDS:
            raise ValueError(f"Unknown movement kind {m.kind!r}")

    main_warehouse_id: int | None = None
    if any(m.warehouse_id is None for m in movements):
        main_warehouse_id = db.execute(
            select(Warehouse.id).where(Warehouse.code == MAIN_WAREHOUSE_CODE)
        ).scalar_one()

    resolved = [(m, m.warehouse_id or main_warehouse_id) for m in movements]

    deltas: dict[tuple[int, int], int] = {}
    for m, warehouse_id in resolved:
        key = (m.product_id, warehouse_id)
        deltas[key] = deltas.get(key, 0) + m.qty
    keys = sorted(deltas)

    db.execute(
        pg_insert(StockBalance)
        .values([{"product_id": p, "warehouse_id": w, "qty": 0} for p, w in keys])
        .on_conflict_do_nothing()
    )

    rows = db.execute(
        select(StockBalance, Product.article)
        .join(Product, Product.id == StockBalance.product_id)
        .where(tuple_(StockBalance.product_id, StockBalance.warehouse_id).in_(keys))
        .order_by(StockBalance.product_id, StockBalance.warehouse_id)
        .with_for_update(of=StockBalance)
        .execution_options(populate_existing=True)
    ).all()
    balances = {(b.product_id, b.warehouse_id): (b, article) for b, article in rows}

    shortages = []
    for key in keys:
        balance, article = balances[key]
        if balance.qty + deltas[key] < 0:
            shortages.append(f"{article}: на остатке {balance.qty}, требуется {-deltas[key]}")
    if shortages:
        raise InsufficientStockError("Недостаточно товара. " + "; ".join(shortages))

    created = [
        StockMovement(
            product_id=m.product_id,
            warehouse_id=warehouse_id,
            qty=m.qty,
            kind=m.kind,
            doc_type=m.doc_type,
            doc_id=m.doc_id,
            note=m.note,
            created_by=user_id,
        )
        for m, warehouse_id in resolved
    ]
    db.add_all(created)
    for key in keys:
        balances[key][0].qty += deltas[key]
    db.flush()
    return created


def _ensure_product_exists(db: Session, product_id: int) -> None:
    if db.get(Product, product_id) is None:
        raise ProductNotFoundError()


def _product_stock(db: Session, product_id: int) -> int:
    query = select(func.coalesce(func.sum(StockBalance.qty), 0)).where(
        StockBalance.product_id == product_id
    )
    return db.execute(query).scalar_one()


def _movements_query(product_id: int) -> Select[tuple[Any, ...]]:
    """Movements of one product with the product's total stock after each of them."""
    history = (
        select(
            StockMovement,
            func.sum(StockMovement.qty)
            .over(order_by=(StockMovement.created_at, StockMovement.id))
            .label("balance_after"),
        )
        .where(StockMovement.product_id == product_id)
        .subquery()
    )
    return (
        select(
            history.c.id,
            history.c.created_at,
            history.c.qty,
            history.c.kind,
            history.c.doc_type,
            history.c.doc_id,
            func.coalesce(Receipt.number, Sale.number).label("doc_number"),
            history.c.note,
            User.full_name.label("created_by_name"),
            history.c.balance_after,
        )
        .join(User, User.id == history.c.created_by)
        .outerjoin(Receipt, and_(history.c.doc_type == "receipt", Receipt.id == history.c.doc_id))
        .outerjoin(Sale, and_(history.c.doc_type == "sale", Sale.id == history.c.doc_id))
        .order_by(history.c.created_at.desc(), history.c.id.desc())
    )


def list_movements(db: Session, product_id: int, limit: int, offset: int) -> MovementPage:
    _ensure_product_exists(db, product_id)
    total = db.execute(
        select(func.count()).where(StockMovement.product_id == product_id)
    ).scalar_one()
    rows = db.execute(_movements_query(product_id).limit(limit).offset(offset)).all()
    items = [MovementOut.model_validate(row, from_attributes=True) for row in rows]
    return MovementPage(items=items, total=total)


def create_adjustment(db: Session, data: AdjustmentCreate, user_id: int) -> AdjustmentOut:
    """Manual stock correction. Allowed for archived products too."""
    _ensure_product_exists(db, data.product_id)
    (movement,) = post_movements(
        db, [MovementIn(data.product_id, data.qty, "adjustment", note=data.reason)], user_id
    )
    db.commit()

    history = _movements_query(data.product_id).subquery()
    row = db.execute(select(history).where(history.c.id == movement.id)).one()
    return AdjustmentOut(
        movement=MovementOut.model_validate(row, from_attributes=True),
        stock=_product_stock(db, data.product_id),
    )
