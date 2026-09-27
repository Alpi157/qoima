from collections import Counter

from sqlalchemy import ColumnElement, Select, case, false, func, literal, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.catalog.models import Product
from app.catalog.normalize import normalize_article
from app.catalog.schemas import ProductCreate, ProductOut, ProductPage, ProductUpdate
from app.db_utils import LIKE_ESCAPE, contains_pattern
from app.errors import (
    DuplicateArticleError,
    InvalidArticleError,
    InvalidDocumentLinesError,
    ProductArchivedError,
    ProductNotFoundError,
)
from app.inventory.models import StockBalance

ARTICLE_NORM_CONSTRAINT = "uq_products_article_norm"

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


def _to_out(product: Product, stock: int) -> ProductOut:
    columns = {c.key: getattr(product, c.key) for c in Product.__table__.columns}
    return ProductOut.model_validate({**columns, "stock": stock})


def get_product(db: Session, product_id: int) -> ProductOut:
    row = db.execute(
        select(Product, _stock_expr())
        .where(Product.id == product_id)
        .execution_options(populate_existing=True)
    ).one_or_none()
    if row is None:
        raise ProductNotFoundError()
    return _to_out(row[0], row[1])


def load_line_products(db: Session, ids: list[int], doc_name: str) -> dict[int, Product]:
    """Products of document lines, by id. Rejects missing, repeated and archived products.

    doc_name completes the message «Товар X указан в <doc_name> дважды», e.g. "приходе".
    """
    products = {
        p.id: p for p in db.execute(select(Product).where(Product.id.in_(set(ids)))).scalars()
    }

    missing = sorted(set(ids) - products.keys())
    if missing:
        raise InvalidDocumentLinesError(f"Товар не найден: {', '.join(map(str, missing))}")

    for product_id, count in Counter(ids).items():
        if count > 1:
            article = products[product_id].article
            raise InvalidDocumentLinesError(f"Товар {article} указан в {doc_name} дважды")

    for product_id in ids:
        if products[product_id].is_archived:
            raise ProductArchivedError(f"Товар {products[product_id].article} в архиве")
    return products


def _duplicate_error(existing: Product) -> DuplicateArticleError:
    return DuplicateArticleError(
        f"Товар с артикулом «{existing.article}» уже есть: {existing.name}"
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


def create_product(db: Session, data: ProductCreate) -> ProductOut:
    article_norm = normalize_article(data.article)
    _ensure_article_free(db, article_norm)

    product = Product(**data.model_dump(), article_norm=article_norm)
    db.add(product)
    _flush_and_commit(db, article_norm)
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
    db: Session, q: str | None, include_archived: bool, limit: int, offset: int
) -> ProductPage:
    conditions: list[ColumnElement[bool]] = []
    if not include_archived:
        conditions.append(Product.is_archived.is_(false()))

    order_by: list[ColumnElement[object]] = [Product.article_norm]
    if q is not None and q.strip():
        condition, order_by = _search_filter_and_order(q)
        conditions.append(condition)

    total = db.execute(select(func.count()).select_from(Product).where(*conditions)).scalar_one()

    query: Select[tuple[Product, int]] = (
        select(Product, _stock_expr())
        .where(*conditions)
        .order_by(*order_by)
        .limit(limit)
        .offset(offset)
    )
    items = [_to_out(product, stock) for product, stock in db.execute(query).all()]
    return ProductPage(items=items, total=total)
