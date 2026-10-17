from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from psycopg.errors import UniqueViolation
from sqlalchemy import Numeric, Select, and_, cast, func, or_, select, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.models import User
from app.catalog.models import Product
from app.db_utils import STOCK_ADJUSTMENT_REQUEST_LOCK, lock_request_id
from app.errors import (
    AdjustmentCostNotAllowedError,
    AdjustmentCostRequiredError,
    InsufficientStockError,
    ProductNotFoundError,
    StockAdjustmentRequestConflictError,
)
from app.inventory.models import (
    MAIN_WAREHOUSE_CODE,
    MOVEMENT_KINDS,
    StockBalance,
    StockMovement,
    Warehouse,
)
from app.inventory.schemas import (
    AdjustmentCreate,
    AdjustmentOut,
    MovementOut,
    MovementPage,
    StockSummary,
)
from app.receipts.models import Receipt
from app.returns.models import SaleReturn
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
    unit_cost: int | None = None
    request_id: UUID | None = None


def round_half_up(numerator: int, denominator: int) -> int:
    """Divide non-negative integers, rounding an exact half up without floats."""
    if (
        type(numerator) is not int
        or type(denominator) is not int
        or numerator < 0
        or denominator <= 0
    ):
        raise ValueError("Expected a non-negative numerator and a positive denominator")
    return (2 * numerator + denominator) // (2 * denominator)


def _apply_cost(balance: StockBalance, movement: MovementIn) -> int | None:
    """Apply one cost transition using the quantity before this movement."""
    cost = movement.unit_cost
    qty = balance.qty
    if movement.kind == "adjustment" and movement.qty > 0 and balance.avg_cost is None:
        balance.avg_cost = cost
    if movement.qty > 0 and movement.kind != "adjustment" and cost is not None:
        if balance.avg_cost is None or qty == 0:
            balance.avg_cost = cost
        else:
            numerator = qty * balance.avg_cost + movement.qty * cost
            denominator = qty + movement.qty
            # Aggregate stock validation permits a temporary negative quantity.
            # An undefined or negative average leaves the previous average intact.
            if numerator >= 0 and denominator > 0:
                balance.avg_cost = round_half_up(numerator, denominator)
        return cost
    if movement.kind in ("receipt_cancel", "return_cancel") and cost is not None:
        remaining = qty + movement.qty
        if remaining > 0 and balance.avg_cost is not None:
            numerator = qty * balance.avg_cost + movement.qty * cost
            if numerator >= 0:
                balance.avg_cost = round_half_up(numerator, remaining)
        return cost
    if movement.kind in ("return", "return_cancel"):
        # Unknown historical return costs stay unknown in the journal.
        return cost
    return balance.avg_cost


def post_movements(
    db: Session,
    movements: Sequence[MovementIn],
    user_id: int,
    *,
    validate_adjustments: bool = False,
) -> list[StockMovement]:
    """Record movements and update balances. Never commits: the caller owns the transaction."""
    if not movements:
        return []

    for m in movements:
        if isinstance(m.qty, bool) or not isinstance(m.qty, int) or m.qty == 0:
            raise ValueError(f"Movement qty must be a non-zero int, got {m.qty!r}")
        if m.kind not in MOVEMENT_KINDS:
            raise ValueError(f"Unknown movement kind {m.kind!r}")
        if m.unit_cost is not None and (
            isinstance(m.unit_cost, bool) or not isinstance(m.unit_cost, int) or m.unit_cost < 0
        ):
            raise ValueError("Movement unit_cost must be a non-negative int or None")

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

    if validate_adjustments:
        for m, warehouse_id in resolved:
            if m.kind != "adjustment":
                continue
            balance = balances[(m.product_id, warehouse_id)][0]
            needs_cost = m.qty > 0 and balance.avg_cost is None
            if needs_cost and m.unit_cost is None:
                raise AdjustmentCostRequiredError()
            if not needs_cost and m.unit_cost is not None:
                raise AdjustmentCostNotAllowedError()

    shortages = []
    for key in keys:
        balance, article = balances[key]
        if balance.qty + deltas[key] < 0:
            shortages.append(
                {"article": article, "available": balance.qty, "requested": -deltas[key]}
            )
    if shortages:
        text = "; ".join(
            f"{s['article']}: на остатке {s['available']}, требуется {s['requested']}"
            for s in shortages
        )
        raise InsufficientStockError(f"Недостаточно товара. {text}", {"items": shortages})

    created = []
    for m, warehouse_id in resolved:
        balance = balances[(m.product_id, warehouse_id)][0]
        unit_cost = _apply_cost(balance, m)
        balance.qty += m.qty
        created.append(
            StockMovement(
                product_id=m.product_id,
                warehouse_id=warehouse_id,
                qty=m.qty,
                unit_cost=unit_cost,
                requested_unit_cost=m.unit_cost if m.kind == "adjustment" else None,
                request_id=m.request_id,
                kind=m.kind,
                doc_type=m.doc_type,
                doc_id=m.doc_id,
                note=m.note,
                created_by=user_id,
            )
        )
    db.add_all(created)
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
            func.coalesce(Receipt.number, Sale.number, SaleReturn.number).label("doc_number"),
            history.c.note,
            User.full_name.label("created_by_name"),
            history.c.balance_after,
        )
        .join(User, User.id == history.c.created_by)
        .outerjoin(Receipt, and_(history.c.doc_type == "receipt", Receipt.id == history.c.doc_id))
        .outerjoin(Sale, and_(history.c.doc_type == "sale", Sale.id == history.c.doc_id))
        .outerjoin(
            SaleReturn, and_(history.c.doc_type == "return", SaleReturn.id == history.c.doc_id)
        )
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


def _adjustment_out(db: Session, movement: StockMovement) -> AdjustmentOut:
    history = _movements_query(movement.product_id).subquery()
    row = db.execute(select(history).where(history.c.id == movement.id)).one()
    return AdjustmentOut(
        movement=MovementOut.model_validate(row, from_attributes=True),
        stock=_product_stock(db, movement.product_id),
    )


def _existing_adjustment(db: Session, data: AdjustmentCreate) -> AdjustmentOut | None:
    movement = db.scalar(select(StockMovement).where(StockMovement.request_id == data.request_id))
    if movement is None:
        return None
    if (
        movement.kind != "adjustment"
        or movement.product_id != data.product_id
        or movement.qty != data.qty
        or movement.note != data.reason
        or movement.requested_unit_cost != data.unit_cost
    ):
        raise StockAdjustmentRequestConflictError(
            params={"movement_id": movement.id, "product_id": movement.product_id}
        )
    return _adjustment_out(db, movement)


def _is_request_id_conflict(exc: IntegrityError) -> bool:
    return (
        isinstance(exc.orig, UniqueViolation)
        and exc.orig.diag.constraint_name == "uq_stock_movements_request_id"
    )


def create_adjustment(
    db: Session, data: AdjustmentCreate, user_id: int
) -> tuple[AdjustmentOut, bool]:
    """Manual stock correction. Allowed for archived products too."""
    lock_request_id(db, STOCK_ADJUSTMENT_REQUEST_LOCK, data.request_id)
    existing = _existing_adjustment(db, data)
    if existing is not None:
        return existing, False
    try:
        _ensure_product_exists(db, data.product_id)
        (movement,) = post_movements(
            db,
            [
                MovementIn(
                    data.product_id,
                    data.qty,
                    "adjustment",
                    note=data.reason,
                    request_id=data.request_id,
                    unit_cost=data.unit_cost,
                )
            ],
            user_id,
            validate_adjustments=True,
        )
        db.commit()
    except IntegrityError as exc:
        if not _is_request_id_conflict(exc):
            raise
        db.rollback()
        existing = _existing_adjustment(db, data)
        if existing is None:
            raise
        return existing, False
    return _adjustment_out(db, movement), True


def stock_summary(db: Session) -> StockSummary:
    main_id = select(Warehouse.id).where(Warehouse.code == MAIN_WAREHOUSE_CODE).scalar_subquery()
    qty = func.coalesce(StockBalance.qty, 0)
    active = Product.is_archived.is_(False)
    archived = and_(Product.is_archived.is_(True), qty > 0)
    row = db.execute(
        select(
            func.count().label("products_count"),
            func.coalesce(func.sum(qty), 0).label("total_qty"),
            func.coalesce(func.sum(cast(qty, Numeric) * StockBalance.avg_cost), 0).label(
                "cost_value"
            ),
            func.coalesce(func.sum(cast(qty, Numeric) * Product.sale_price), 0).label(
                "retail_value"
            ),
            func.count()
            .filter(and_(qty > 0, StockBalance.avg_cost.is_(None)))
            .label("unknown_cost_count"),
            func.count().filter(and_(active, qty == 0)).label("out_of_stock_count"),
            func.count()
            .filter(and_(active, qty > 0, qty <= Product.min_qty))
            .label("low_stock_count"),
            func.count().filter(archived).label("archived_products_count"),
            func.coalesce(
                func.sum(cast(qty, Numeric) * StockBalance.avg_cost).filter(archived), 0
            ).label("archived_cost_value"),
        )
        .select_from(Product)
        .outerjoin(
            StockBalance,
            and_(StockBalance.product_id == Product.id, StockBalance.warehouse_id == main_id),
        )
        .where(or_(active, archived))
    ).one()
    return StockSummary.model_validate(row, from_attributes=True)
