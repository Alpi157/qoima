from itertools import count

from sqlalchemy.orm import Session

from app.auth.models import User
from app.catalog.models import Product
from app.catalog.normalize import normalize_article

_seq = count(1)


def create_user(db: Session, username: str | None = None, full_name: str = "Тест") -> User:
    user = User(
        username=username or f"user{next(_seq)}",
        password_hash="not-a-real-hash",
        full_name=full_name,
    )
    db.add(user)
    db.flush()
    return user


def create_product(
    db: Session, article: str | None = None, name: str = "Товар", sale_price: int = 0
) -> Product:
    article = article or f"TST-{next(_seq)}"
    product = Product(
        article=article,
        article_norm=normalize_article(article),
        name=name,
        sale_price=sale_price,
    )
    db.add(product)
    db.flush()
    return product
