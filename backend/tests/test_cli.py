from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import cli
from app.auth.dependencies import SESSION_COOKIE
from app.auth.models import User
from app.auth.service import verify_password
from tests.factories import create_user


def _fake_getpass(*answers: str) -> Callable[[str], str]:
    inputs = iter(answers)
    return lambda _prompt="": next(inputs)


def _get_user(db: Session, username: str) -> User | None:
    return db.execute(select(User).where(User.username == username)).scalar_one_or_none()


def test_create_user(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(cli, "getpass", _fake_getpass("secret-123", "secret-123"))

    code = cli.create_user_command(db_session, " Owner ", "Владелец")

    assert code == 0
    assert "создан" in capsys.readouterr().out
    user = _get_user(db_session, "owner")
    assert user is not None
    assert user.full_name == "Владелец"
    assert user.is_active
    assert verify_password(user.password_hash, "secret-123")


def test_create_user_duplicate_username(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    create_user(db_session, username="owner")
    monkeypatch.setattr(cli, "getpass", _fake_getpass("secret-123", "secret-123"))

    code = cli.create_user_command(db_session, "OWNER", "Другой")

    assert code == 1
    assert "уже существует" in capsys.readouterr().err


def test_create_user_short_password(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(cli, "getpass", _fake_getpass("short", "short"))

    code = cli.create_user_command(db_session, "owner", "Владелец")

    assert code == 1
    assert "не короче 8 символов" in capsys.readouterr().err
    assert _get_user(db_session, "owner") is None


def test_create_user_passwords_mismatch(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(cli, "getpass", _fake_getpass("secret-123", "secret-124"))

    code = cli.create_user_command(db_session, "owner", "Владелец")

    assert code == 1
    assert "не совпадают" in capsys.readouterr().err
    assert _get_user(db_session, "owner") is None


def test_set_password(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    user = create_user(db_session, username="owner", password="old-password")
    monkeypatch.setattr(cli, "getpass", _fake_getpass("new-password", "new-password"))

    code = cli.set_password_command(db_session, "Owner")

    assert code == 0
    assert "изменён" in capsys.readouterr().out
    db_session.refresh(user)
    assert verify_password(user.password_hash, "new-password")
    assert not verify_password(user.password_hash, "old-password")


def test_set_password_logs_out_all_sessions(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    create_user(db_session, username="owner", password="old-password")
    login = client.post("/api/auth/login", json={"username": "owner", "password": "old-password"})
    old_token = login.cookies[SESSION_COOKIE]
    assert client.get("/api/auth/me").status_code == 200
    monkeypatch.setattr(cli, "getpass", _fake_getpass("new-password", "new-password"))

    assert cli.set_password_command(db_session, "owner") == 0

    client.cookies.set(SESSION_COOKIE, old_token)
    assert client.get("/api/auth/me").status_code == 401


def test_set_password_unknown_user(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(cli, "getpass", _fake_getpass("new-password", "new-password"))

    code = cli.set_password_command(db_session, "nobody")

    assert code == 1
    assert "не найден" in capsys.readouterr().err


def test_set_password_short(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    create_user(db_session, username="owner", password="old-password")
    monkeypatch.setattr(cli, "getpass", _fake_getpass("short", "short"))

    code = cli.set_password_command(db_session, "owner")

    assert code == 1
    assert "не короче 8 символов" in capsys.readouterr().err
