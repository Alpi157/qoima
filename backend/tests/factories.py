from itertools import count

from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.service import hash_password
from app.catalog.models import Product
from app.catalog.normalize import normalize_article
from app.customers.models import Customer

_seq = count(1)


def create_user(
    db: Session,
    username: str | None = None,
    full_name: str = "Тест",
    password: str | None = None,
    is_active: bool = True,
) -> User:
    user = User(
        username=username or f"user{next(_seq)}",
        password_hash=hash_password(password) if password else "not-a-real-hash",
        full_name=full_name,
        is_active=is_active,
    )
    db.add(user)
    db.flush()
    return user


def create_product(
    db: Session,
    article: str | None = None,
    name: str = "Товар",
    sale_price: int = 0,
    is_archived: bool = False,
) -> Product:
    article = article or f"TST-{next(_seq)}"
    product = Product(
        article=article,
        article_norm=normalize_article(article),
        name=name,
        sale_price=sale_price,
        is_archived=is_archived,
    )
    db.add(product)
    db.flush()
    return product


def create_customer(db: Session, name: str = "Покупатель", phone: str | None = None) -> Customer:
    customer = Customer(name=name, phone=phone)
    db.add(customer)
    db.flush()
    return customer
