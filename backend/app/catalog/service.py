from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from sqlalchemy import ColumnElement, case, false, func, literal, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.catalog.models import Product
from app.catalog.normalize import normalize_article
from app.catalog.schemas import (
    ProductCreate,
    ProductOut,
    ProductPage,
    ProductPurchaseOut,
    ProductPurchasePage,
    ProductUpdate,
)
from app.db_utils import LIKE_ESCAPE, contains_pattern
from app.errors import (
    DuplicateArticleError,
    DuplicateLineError,
    InvalidArticleError,
    LineProductNotFoundError,
    ProductArchivedError,
    ProductNotFoundError,
)
from app.inventory.models import MAIN_WAREHOUSE_CODE, StockBalance, Warehouse
from app.receipts.models import Receipt, ReceiptLine
from app.sales.models import Sale, SaleLine

ARTICLE_NORM_CONSTRAINT = "uq_products_article_norm"

# Sales older than this do not make a product "frequent".
FREQUENT_PERIOD = timedelta(days=30)

# Search ranks: exact article, article prefix, article substring, name match.
RANK_NAME = 3


def _stock_expr() -> ColumnElement[int]:
    """Total quantity over all warehouses, 0 when the product has no balance rows."""
    return (
        select(func.coalesce(func.sum(StockBalance.qty), 0))
        .where(StockBalance.product_id == Product.id)
        .correlate(Product)
        .scalar_subquery()
    )


def _avg_cost_expr() -> ColumnElement[int]:
    return (
        select(StockBalance.avg_cost)
        .join(Warehouse, Warehouse.id == StockBalance.warehouse_id)
        .where(StockBalance.product_id == Product.id, Warehouse.code == MAIN_WAREHOUSE_CODE)
        .correlate(Product)
        .scalar_subquery()
    )


def _purchase_query(*columns):
    return (
        select(*columns)
        .select_from(ReceiptLine)
        .join(Receipt, Receipt.id == ReceiptLine.receipt_id)
        .where(Receipt.status == "posted", ReceiptLine.unit_cost.is_not(None))
    )


def _last_purchase_expr(column):
    return (
        _purchase_query(column)
        .where(ReceiptLine.product_id == Product.id)
        .order_by(Receipt.received_at.desc(), ReceiptLine.id.desc())
        .limit(1)
        .correlate(Product)
        .scalar_subquery()
    )


def _last_cost_expr() -> ColumnElement[int]:
    return _last_purchase_expr(ReceiptLine.unit_cost)


@dataclass(frozen=True)
class LastPurchase:
    unit_cost: int
    received_at: datetime


def load_last_purchases(db: Session, product_ids: list[int]) -> dict[int, LastPurchase]:
    ranked = (
        _purchase_query(
            ReceiptLine.product_id,
            ReceiptLine.unit_cost,
            Receipt.received_at,
            func.row_number()
            .over(
                partition_by=ReceiptLine.product_id,
                order_by=(Receipt.received_at.desc(), ReceiptLine.id.desc()),
            )
            .label("rank"),
        )
        .where(ReceiptLine.product_id.in_(product_ids))
        .subquery()
    )
    rows = db.execute(select(ranked).where(ranked.c.rank == 1))
    return {row.product_id: LastPurchase(row.unit_cost, row.received_at) for row in rows}


def _product_columns():
    return (
        Product,
        _stock_expr(),
        _avg_cost_expr(),
        _last_cost_expr(),
        _last_purchase_expr(Receipt.currency),
        _last_purchase_expr(ReceiptLine.unit_price_minor),
    )


def _to_out(
    product: Product,
    stock: int,
    avg_cost: int | None,
    last_cost: int | None,
    last_purchase_currency: str | None,
    last_purchase_price_minor: int | None,
) -> ProductOut:
    columns = {c.key: getattr(product, c.key) for c in Product.__table__.columns}
    return ProductOut.model_validate(
        {
            **columns,
            "stock": stock,
            "avg_cost": avg_cost,
            "last_cost": last_cost,
            "last_purchase_currency": last_purchase_currency,
            "last_purchase_price_minor": last_purchase_price_minor,
        }
    )


def get_product(db: Session, product_id: int) -> ProductOut:
    row = db.execute(
        select(*_product_columns())
        .where(Product.id == product_id)
        .execution_options(populate_existing=True)
    ).one_or_none()
    if row is None:
        raise ProductNotFoundError()
    return _to_out(*row)


def product_purchases(db: Session, product_id: int, limit: int, offset: int) -> ProductPurchasePage:
    """Saved purchase lines, including historical unknown costs; never recalculate totals."""
    if db.scalar(select(Product.id).where(Product.id == product_id)) is None:
        raise ProductNotFoundError()
    conditions = (ReceiptLine.product_id == product_id, Receipt.status == "posted")
    total = db.scalar(
        select(func.count())
        .select_from(ReceiptLine)
        .join(Receipt, Receipt.id == ReceiptLine.receipt_id)
        .where(*conditions)
    )
    rows = db.execute(
        select(ReceiptLine, Receipt)
        .join(Receipt, Receipt.id == ReceiptLine.receipt_id)
        .where(*conditions)
        .order_by(Receipt.received_at.desc(), ReceiptLine.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return ProductPurchasePage(
        items=[
            ProductPurchaseOut(
                receipt_id=receipt.id,
                receipt_number=receipt.number,
                received_at=receipt.received_at,
                currency=receipt.currency,
                exchange_rate=format(receipt.exchange_rate, ".4f"),
                unit_price_minor=line.unit_price_minor,
                qty=line.qty,
                unit_cost=line.unit_cost,
                total=(line.goods_total + line.expenses_total)
                if line.goods_total is not None
                else None,
            )
            for line, receipt in rows
        ],
        total=total,
    )


# Document type -> the word completing «Товар X указан в … дважды».
_DOCUMENT_IN = {"receipt": "приходе", "sale": "продаже"}


def load_line_products(
    db: Session, ids: list[int], document: Literal["receipt", "sale"]
) -> dict[int, Product]:
    """Products of document lines, by id. Rejects missing, repeated and archived products."""
    products = {
        p.id: p for p in db.execute(select(Product).where(Product.id.in_(set(ids)))).scalars()
    }

    missing = sorted(set(ids) - products.keys())
    if missing:
        raise LineProductNotFoundError(
            f"Товар не найден: {', '.join(map(str, missing))}", {"product_ids": missing}
        )

    for product_id, count in Counter(ids).items():
        if count > 1:
            article = products[product_id].article
            raise DuplicateLineError(
                f"Товар {article} указан в {_DOCUMENT_IN[document]} дважды",
                {"article": article, "document": document},
            )

    for product_id in ids:
        if products[product_id].is_archived:
            article = products[product_id].article
            raise ProductArchivedError(f"Товар {article} в архиве", {"article": article})
    return products


def _duplicate_error(existing: Product) -> DuplicateArticleError:
    return DuplicateArticleError(
        f"Товар с артикулом «{existing.article}» уже есть: {existing.name}",
        {"article": existing.article, "existing_name": existing.name},
    )


def _find_by_article_norm(
    db: Session, article_norm: str, exclude_id: int | None = None
) -> Product | None:
    query = select(Product).where(Product.article_norm == article_norm)
    if exclude_id is not None:
        query = query.where(Product.id != exclude_id)
    return db.execute(query).scalar_one_or_none()


def _ensure_article_free(db: Session, article_norm: str, exclude_id: int | None = None) -> None:
    existing = _find_by_article_norm(db, article_norm, exclude_id)
    if existing is not None:
        raise _duplicate_error(existing)


def _flush_and_commit(db: Session, article_norm: str) -> None:
    """Commit, turning a lost race on the unique article into the same 409 as the pre-check."""
    try:
        db.flush()
    except IntegrityError as exc:
        constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        db.rollback()
        if constraint != ARTICLE_NORM_CONSTRAINT:
            raise
        existing = _find_by_article_norm(db, article_norm)
        if existing is None:
            raise
        raise _duplicate_error(existing) from exc
    db.commit()


def _create_product(db: Session, data: ProductCreate) -> Product:
    """Add a validated product. The caller owns flushing and the transaction."""
    article_norm = normalize_article(data.article)
    _ensure_article_free(db, article_norm)

    product = Product(**data.model_dump(), article_norm=article_norm)
    db.add(product)
    return product


def create_product(db: Session, data: ProductCreate) -> ProductOut:
    product = _create_product(db, data)
    _flush_and_commit(db, product.article_norm)
    return get_product(db, product.id)


def update_product(db: Session, product_id: int, data: ProductUpdate) -> ProductOut:
    product = db.get(Product, product_id)
    if product is None:
        raise ProductNotFoundError()

    changes = data.model_dump(exclude_unset=True)
    if "article" in changes:
        article_norm = normalize_article(changes["article"])
        _ensure_article_free(db, article_norm, exclude_id=product.id)
        changes["article_norm"] = article_norm
    for field, value in changes.items():
        setattr(product, field, value)

    _flush_and_commit(db, product.article_norm)
    return get_product(db, product.id)


def _search_filter_and_order(
    q: str,
) -> tuple[ColumnElement[bool], list[ColumnElement[object]]]:
    try:
        qn: str | None = normalize_article(q)
    except InvalidArticleError:
        # Query has no letters or digits: nothing to match by article.
        qn = None

    name_q = q.strip().lower()
    name_lower = func.lower(Product.name)
    name_match = or_(
        name_lower.like(contains_pattern(name_q), escape=LIKE_ESCAPE),
        # word similarity; the operator form lets PostgreSQL use the GIN trigram index.
        literal(name_q).op("<%")(name_lower),
    )

    if qn is None:
        condition: ColumnElement[bool] = name_match
        rank: ColumnElement[int] = literal(RANK_NAME)
    else:
        # qn holds only [A-Z0-9А-ЯЁ], so it needs no LIKE escaping.
        condition = or_(Product.article_norm.contains(qn), name_match)
        rank = case(
            (Product.article_norm == qn, 0),
            (Product.article_norm.startswith(qn), 1),
            (Product.article_norm.contains(qn), 2),
            else_=RANK_NAME,
        )

    similarity = func.word_similarity(name_q, name_lower)
    return condition, [rank, similarity.desc(), Product.article_norm]


def search_products(
    db: Session,
    q: str | None,
    include_archived: bool,
    limit: int,
    offset: int,
    stock_state: Literal["out", "low"] | None = None,
) -> ProductPage:
    conditions: list[ColumnElement[bool]] = []
    if not include_archived or stock_state is not None:
        conditions.append(Product.is_archived.is_(false()))

    if stock_state == "out":
        conditions.append(_stock_expr() == 0)
    elif stock_state == "low":
        conditions.extend(
            [Product.min_qty.is_not(None), _stock_expr() > 0, _stock_expr() <= Product.min_qty]
        )

    order_by: list[ColumnElement[object]] = [Product.article_norm]
    if q is not None and q.strip():
        condition, order_by = _search_filter_and_order(q)
        conditions.append(condition)

    total = db.execute(select(func.count()).select_from(Product).where(*conditions)).scalar_one()

    query = (
        select(*_product_columns())
        .where(*conditions)
        .order_by(*order_by)
        .limit(limit)
        .offset(offset)
    )
    items = [_to_out(*row) for row in db.execute(query).all()]
    return ProductPage(items=items, total=total)


def frequent_products(db: Session, limit: int) -> list[ProductOut]:
    """Products by the number of posted sales over the last FREQUENT_PERIOD, then by article."""
    sale_count = func.count(Sale.id.distinct())
    query = (
        select(*_product_columns())
        .join(SaleLine, SaleLine.product_id == Product.id)
        .join(Sale, Sale.id == SaleLine.sale_id)
        .where(
            Product.is_archived.is_(false()),
            Sale.status == "posted",
            Sale.sold_at >= func.now() - FREQUENT_PERIOD,
        )
        .group_by(Product.id)
        .order_by(sale_count.desc(), Product.article_norm, Product.id)
        .limit(limit)
    )
    return [_to_out(*row) for row in db.execute(query).all()]
