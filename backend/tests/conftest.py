import os
import subprocess
import urllib.request
import uuid
from collections.abc import Generator
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.auth.rate_limit import login_rate_limiter
from app.config import get_settings
from app.db import Base, get_db
from app.inventory.service import MovementIn, post_movements
from app.main import app
from app.rates import router as rates_router
from app.rates import service as rates_service
from tests import factories

BACKEND_DIR = Path(__file__).resolve().parents[1]

settings = get_settings()

if not settings.test_database_url:
    raise RuntimeError("TEST_DATABASE_URL не задан — тесты не могут подключиться к базе")

if settings.test_database_url == settings.database_url:
    raise RuntimeError(
        "TEST_DATABASE_URL совпадает с DATABASE_URL — тесты не должны работать с основной базой"
    )

_test_db_name = settings.test_database_url.rsplit("/", 1)[-1].split("?", 1)[0]
if not _test_db_name.endswith("_test"):
    raise RuntimeError(
        f"Имя базы в TEST_DATABASE_URL ('{_test_db_name}') должно заканчиваться на '_test' — "
        "это защита от случайного запуска тестов на обычной базе"
    )

test_engine = create_engine(settings.test_database_url, pool_pre_ping=True)
TestSessionLocal = sessionmaker(
    bind=test_engine,
    autoflush=False,
    expire_on_commit=False,
    join_transaction_mode="create_savepoint",
)


@pytest.fixture(scope="session", autouse=True)
def apply_migrations() -> None:
    env = {**os.environ, "DATABASE_URL": settings.test_database_url}
    subprocess.run(
        ["uv", "run", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        env=env,
        check=True,
    )


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    connection = test_engine.connect()
    outer_transaction = connection.begin()
    session = TestSessionLocal(bind=connection)

    try:
        yield session
    finally:
        session.close()
        outer_transaction.rollback()
        connection.close()


@pytest.fixture
def client(db_session: Session) -> Generator[TestClient, None, None]:
    def _get_db_override() -> Generator[Session, None, None]:
        # In production get_db closes the session, so a failed request leaves nothing behind.
        # Here the session is shared with the test: undo only this request's uncommitted work.
        request_tx = db_session.begin_nested()
        try:
            yield db_session
        except Exception:
            if request_tx.is_active:
                request_tx.rollback()
            raise
        if request_tx.is_active:
            request_tx.commit()

    app.dependency_overrides[get_db] = _get_db_override
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def reset_login_rate_limit() -> None:
    login_rate_limiter.reset()


@pytest.fixture(autouse=True)
def forbid_http_network(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("Unexpected HTTP network request: replace the transport with a fixture")

    monkeypatch.setattr(urllib.request, "urlopen", forbidden)
    monkeypatch.setattr(urllib.request.OpenerDirector, "open", forbidden)
    monkeypatch.setattr(rates_service, "_failures", {})
    # Even an accidental /api/rates call in another test must never use the main DB.
    monkeypatch.setattr(rates_router, "SessionLocal", TestSessionLocal)


@pytest.fixture
def auth_client(client: TestClient, db_session: Session) -> TestClient:
    """Client with a valid session cookie of a freshly created user."""
    user = factories.create_user(db_session, password="test-password")
    response = client.post(
        "/api/auth/login", json={"username": user.username, "password": "test-password"}
    )
    assert response.status_code == 200
    return client


@pytest.fixture
def isolated_stock_engine():
    """Committed stock tests in qoima_test without deleting append-only journal rows.

    Each test owns a schema with the same metadata, constraints and journal trigger.
    Dropping that schema afterwards leaves the public test schema untouched.
    """
    schema = f"step17_{uuid.uuid4().hex}"
    with test_engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    isolated = create_engine(
        test_engine.url, connect_args={"options": f"-csearch_path={schema},public"}
    )
    try:
        with isolated.begin() as conn:
            Base.metadata.create_all(conn, checkfirst=False)
            conn.execute(
                text("""
                CREATE TRIGGER stock_movements_append_only
                BEFORE UPDATE OR DELETE OR TRUNCATE ON stock_movements
                FOR EACH STATEMENT EXECUTE FUNCTION public.stock_movements_forbid_change()
            """)
            )
            conn.execute(text("INSERT INTO warehouses (code,name) VALUES ('main','Основной')"))
            conn.execute(
                text(
                    "INSERT INTO document_counters (doc_type,last_number) VALUES "
                    "('receipt',0),('sale',0),('payment',0),('return',0),('debt_adjustment',0)"
                )
            )
            conn.execute(text("INSERT INTO business_settings (id) VALUES (1)"))
        yield isolated
    finally:
        isolated.dispose()
        with test_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


@pytest.fixture
def return_case(db_session):
    user = factories.create_user(db_session)
    customer = factories.create_customer(db_session)
    product = factories.create_product(db_session, article="RET-1", sale_price=100)
    post_movements(db_session, [MovementIn(product.id, 100, "receipt", unit_cost=40)], user.id)
    return SimpleNamespace(db=db_session, user=user.id, customer=customer.id, product=product.id)
