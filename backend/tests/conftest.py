import os
import subprocess
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.auth.rate_limit import login_rate_limiter
from app.config import get_settings
from app.db import get_db
from app.main import app
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
        yield db_session

    app.dependency_overrides[get_db] = _get_db_override
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def reset_login_rate_limit() -> None:
    login_rate_limiter.reset()


@pytest.fixture
def auth_client(client: TestClient, db_session: Session) -> TestClient:
    """Client with a valid session cookie of a freshly created user."""
    user = factories.create_user(db_session, password="test-password")
    response = client.post(
        "/api/auth/login", json={"username": user.username, "password": "test-password"}
    )
    assert response.status_code == 200
    return client
