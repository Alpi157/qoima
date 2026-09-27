import hashlib
from datetime import UTC, datetime, timedelta

import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.auth.dependencies import SESSION_COOKIE
from app.auth.models import UserSession
from app.auth.rate_limit import LoginRateLimiter
from app.auth.service import verify_password
from app.main import app
from tests.factories import create_user

PASSWORD = "correct-horse-1"
INVALID_CREDENTIALS = {"detail": "Неверный логин или пароль", "code": "invalid_credentials"}
NOT_AUTHENTICATED = {"detail": "Требуется вход", "code": "not_authenticated"}


def _login(client: TestClient, username: str, password: str = PASSWORD):
    return client.post("/api/auth/login", json={"username": username, "password": password})


def _session_count(db: Session, user_id: int) -> int:
    query = select(func.count()).where(UserSession.user_id == user_id)
    return db.execute(query).scalar_one()


def _add_session(db: Session, user_id: int, token: str, started_days_ago: int) -> UserSession:
    started = datetime.now(UTC) - timedelta(days=started_days_ago)
    session = UserSession(
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        user_id=user_id,
        expires_at=started + timedelta(days=30),
        last_seen_at=started,
    )
    db.add(session)
    db.flush()
    return session


def test_login_success_sets_cookie_and_stores_token_hash(
    client: TestClient, db_session: Session
) -> None:
    user = create_user(db_session, username="owner", full_name="Владелец", password=PASSWORD)

    response = _login(client, "owner")

    assert response.status_code == 200
    assert response.json() == {
        "id": user.id,
        "username": "owner",
        "full_name": "Владелец",
        "role": "owner",
    }
    set_cookie = response.headers["set-cookie"].lower()
    assert set_cookie.startswith(f"{SESSION_COOKIE}=")
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie
    assert "path=/" in set_cookie
    assert f"max-age={30 * 24 * 3600}" in set_cookie

    token = response.cookies[SESSION_COOKIE]
    session = db_session.execute(
        select(UserSession).where(UserSession.user_id == user.id)
    ).scalar_one()
    assert session.token_hash == hashlib.sha256(token.encode()).hexdigest()
    assert session.token_hash != token
    lifetime = session.expires_at - session.last_seen_at
    assert lifetime == timedelta(days=30)


def test_me_returns_current_user(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, username="owner", password=PASSWORD)
    _login(client, "owner")

    response = client.get("/api/auth/me")

    assert response.status_code == 200
    assert response.json()["id"] == user.id


@pytest.mark.parametrize(
    ("username", "password", "is_active"),
    [
        ("owner", "wrong-password", True),
        ("nobody", PASSWORD, True),
        ("owner", PASSWORD, False),
    ],
    ids=["wrong-password", "unknown-user", "inactive-user"],
)
def test_login_failures_share_one_error(
    client: TestClient, db_session: Session, username: str, password: str, is_active: bool
) -> None:
    user = create_user(db_session, username="owner", password=PASSWORD, is_active=is_active)

    response = _login(client, username, password)

    assert response.status_code == 401
    assert response.json() == INVALID_CREDENTIALS
    assert SESSION_COOKIE not in response.cookies
    assert _session_count(db_session, user.id) == 0


def test_login_ignores_case_and_surrounding_spaces(client: TestClient, db_session: Session) -> None:
    create_user(db_session, username="owner", password=PASSWORD)

    response = _login(client, "  OwNeR ")

    assert response.status_code == 200
    assert response.json()["username"] == "owner"


def test_me_without_cookie(client: TestClient) -> None:
    response = client.get("/api/auth/me")

    assert response.status_code == 401
    assert response.json() == NOT_AUTHENTICATED


def test_me_with_garbage_cookie(client: TestClient) -> None:
    client.cookies.set(SESSION_COOKIE, "garbage")

    response = client.get("/api/auth/me")

    assert response.status_code == 401
    assert response.json() == NOT_AUTHENTICATED


def test_me_with_expired_session(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, password=PASSWORD)
    _add_session(db_session, user.id, "expired-token", started_days_ago=31)
    client.cookies.set(SESSION_COOKIE, "expired-token")

    response = client.get("/api/auth/me")

    assert response.status_code == 401
    assert response.json() == NOT_AUTHENTICATED


def test_login_removes_only_expired_sessions_of_user(
    client: TestClient, db_session: Session
) -> None:
    user = create_user(db_session, username="owner", password=PASSWORD)
    other = create_user(db_session, password=PASSWORD)
    expired = _add_session(db_session, user.id, "expired-token", started_days_ago=31)
    active = _add_session(db_session, user.id, "active-token", started_days_ago=1)
    other_expired = _add_session(db_session, other.id, "other-expired", started_days_ago=31)
    expired_id, active_id, other_expired_id = expired.id, active.id, other_expired.id

    assert _login(client, "owner").status_code == 200

    db_session.expire_all()
    remaining = set(db_session.execute(select(UserSession.id)).scalars())
    assert expired_id not in remaining
    assert active_id in remaining
    assert other_expired_id in remaining
    assert _session_count(db_session, user.id) == 2


def test_me_after_user_deactivated(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, username="owner", password=PASSWORD)
    _login(client, "owner")
    user.is_active = False
    db_session.flush()

    response = client.get("/api/auth/me")

    assert response.status_code == 401


def test_logout_deletes_session_and_cookie(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session, username="owner", password=PASSWORD)
    token = _login(client, "owner").cookies[SESSION_COOKIE]

    response = client.post("/api/auth/logout")

    assert response.status_code == 204
    set_cookie = response.headers["set-cookie"].lower()
    assert set_cookie.startswith(f'{SESSION_COOKIE}="";') or "max-age=0" in set_cookie
    assert _session_count(db_session, user.id) == 0

    # Even if the browser kept the old cookie, the session is gone.
    client.cookies.set(SESSION_COOKIE, token)
    assert client.get("/api/auth/me").status_code == 401


def test_logout_without_cookie(client: TestClient) -> None:
    response = client.post("/api/auth/logout")

    assert response.status_code == 204


def test_rate_limit_blocks_sixth_attempt_even_with_correct_password(
    client: TestClient, db_session: Session
) -> None:
    create_user(db_session, username="owner", password=PASSWORD)
    for _ in range(5):
        assert _login(client, "owner", "wrong-password").status_code == 401

    response = _login(client, "owner")

    assert response.status_code == 429
    assert response.json() == {
        "detail": "Слишком много попыток входа. Попробуйте через минуту",
        "code": "too_many_login_attempts",
    }


def test_successful_logins_do_not_count_towards_limit(
    client: TestClient, db_session: Session
) -> None:
    create_user(db_session, username="owner", password=PASSWORD)
    for _ in range(6):
        assert _login(client, "owner").status_code == 200


def _proxied_client(trusted_hosts: list[str]) -> TestClient:
    """The app behind uvicorn's --proxy-headers handling, as run in production.

    TestClient connects from host "testclient"; uvicorn trusts it when it is listed.
    Relies on the `client` fixture for the test database override.
    """
    return TestClient(ProxyHeadersMiddleware(app, trusted_hosts=trusted_hosts))


def _login_from(client: TestClient, forwarded_for: str, password: str) -> int:
    response = client.post(
        "/api/auth/login",
        json={"username": "owner", "password": password},
        headers={"X-Forwarded-For": forwarded_for},
    )
    return response.status_code


def test_rate_limit_uses_forwarded_ip_from_trusted_proxy(
    client: TestClient, db_session: Session
) -> None:
    create_user(db_session, username="owner", password=PASSWORD)
    proxied = _proxied_client(["testclient"])
    for _ in range(5):
        assert _login_from(proxied, "203.0.113.7", "wrong-password") == 401

    assert _login_from(proxied, "203.0.113.7", PASSWORD) == 429
    # Another client behind the same proxy is not blocked.
    assert _login_from(proxied, "203.0.113.8", PASSWORD) == 200


def test_rate_limit_ignores_forwarded_ip_from_untrusted_client(
    client: TestClient, db_session: Session
) -> None:
    create_user(db_session, username="owner", password=PASSWORD)
    proxied = _proxied_client(["172.30.0.10"])
    for i in range(5):
        assert _login_from(proxied, f"203.0.113.{i}", "wrong-password") == 401

    # A fresh fake address does not help: the limit is on the real peer address.
    assert _login_from(proxied, "203.0.113.99", PASSWORD) == 429


def test_rate_limiter_window_expires() -> None:
    now = [1000.0]
    limiter = LoginRateLimiter(max_failures=5, window_seconds=60, clock=lambda: now[0])
    for _ in range(5):
        limiter.record_failure("1.2.3.4")

    assert limiter.is_blocked("1.2.3.4")
    assert not limiter.is_blocked("5.6.7.8")

    now[0] += 60
    assert not limiter.is_blocked("1.2.3.4")


def test_rate_limiter_reset() -> None:
    limiter = LoginRateLimiter(max_failures=2, window_seconds=60)
    limiter.record_failure("ip")
    limiter.record_failure("ip")

    assert limiter.is_blocked("ip")
    limiter.reset()
    assert not limiter.is_blocked("ip")


def test_password_stored_as_argon2_hash(db_session: Session) -> None:
    user = create_user(db_session, password=PASSWORD)

    assert user.password_hash.startswith("$argon2id$")
    assert PASSWORD not in user.password_hash
    assert verify_password(user.password_hash, PASSWORD)


def test_login_rehashes_outdated_hash(client: TestClient, db_session: Session) -> None:
    weak_hash = PasswordHasher(time_cost=1, memory_cost=8 * 1024, parallelism=1).hash(PASSWORD)
    user = create_user(db_session, username="owner")
    user.password_hash = weak_hash
    db_session.flush()

    assert _login(client, "owner").status_code == 200

    db_session.refresh(user)
    assert user.password_hash != weak_hash
    assert verify_password(user.password_hash, PASSWORD)


def test_health_is_public(client: TestClient) -> None:
    assert client.get("/api/health").status_code == 200
