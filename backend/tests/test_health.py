from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.db import get_db
from app.main import app


def test_health_ok(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": "ok"}


class _BrokenSession:
    def execute(self, *_args: object, **_kwargs: object) -> None:
        raise OperationalError("SELECT 1", {}, Exception("connection refused"))


def test_health_db_unavailable() -> None:
    def _broken_db() -> Generator[_BrokenSession, None, None]:
        yield _BrokenSession()

    app.dependency_overrides[get_db] = _broken_db
    try:
        with TestClient(app) as broken_client:
            response = broken_client.get("/api/health")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json() == {"status": "error", "db": "unavailable"}
