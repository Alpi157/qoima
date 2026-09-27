from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import select, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.catalog.models import Product
from app.errors import InsufficientStockError
from app.inventory.models import (
    MAIN_WAREHOUSE_CODE,
    MOVEMENT_KINDS,
    StockBalance,
    StockMovement,
    Warehouse,
)


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
