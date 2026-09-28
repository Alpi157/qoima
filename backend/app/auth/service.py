import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth.models import DEFAULT_LOCALE, User, UserSession
from app.errors import (
    InvalidCredentialsError,
    InvalidUserDataError,
    UsernameTakenError,
    UserNotFoundError,
)

SESSION_TTL = timedelta(days=30)
MIN_PASSWORD_LENGTH = 8

_hasher = PasswordHasher()
# Verified against when the username does not exist, so response time does not reveal it.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


def normalize_username(username: str) -> str:
    return username.strip().lower()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


def _validate_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise InvalidUserDataError(
            f"Пароль должен быть не короче {MIN_PASSWORD_LENGTH} символов",
            {"field": "password", "min_length": MIN_PASSWORD_LENGTH},
        )


def login(db: Session, username: str, password: str) -> tuple[User, str]:
    """Check credentials, create a session and commit. Returns the user and the raw token."""
    user = db.execute(
        select(User).where(User.username == normalize_username(username))
    ).scalar_one_or_none()

    if user is None:
        verify_password(_DUMMY_HASH, password)
        raise InvalidCredentialsError()
    if not verify_password(user.password_hash, password) or not user.is_active:
        raise InvalidCredentialsError()

    if _hasher.check_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)

    now = datetime.now(UTC)
    db.execute(
        delete(UserSession).where(UserSession.user_id == user.id, UserSession.expires_at <= now)
    )
    raw_token = secrets.token_urlsafe(32)
    db.add(
        UserSession(
            token_hash=_hash_token(raw_token),
            user_id=user.id,
            expires_at=now + SESSION_TTL,
            last_seen_at=now,
        )
    )
    db.commit()
    return user, raw_token


def get_user_by_token(db: Session, raw_token: str) -> User | None:
    """Active user of a non-expired session, or None. Sessions are not extended."""
    return db.execute(
        select(User)
        .join(UserSession, UserSession.user_id == User.id)
        .where(
            UserSession.token_hash == _hash_token(raw_token),
            UserSession.expires_at > datetime.now(UTC),
            User.is_active.is_(True),
        )
    ).scalar_one_or_none()


def logout(db: Session, raw_token: str) -> None:
    db.execute(delete(UserSession).where(UserSession.token_hash == _hash_token(raw_token)))
    db.commit()


def create_user(
    db: Session, username: str, full_name: str, password: str, locale: str = DEFAULT_LOCALE
) -> User:
    username = normalize_username(username)
    full_name = full_name.strip()
    if not username:
        raise InvalidUserDataError("Логин не может быть пустым", {"field": "username"})
    if not full_name:
        raise InvalidUserDataError("Имя не может быть пустым", {"field": "full_name"})
    _validate_password(password)

    exists = db.execute(select(User.id).where(User.username == username)).first()
    if exists is not None:
        raise UsernameTakenError()

    user = User(
        username=username,
        full_name=full_name,
        password_hash=hash_password(password),
        locale=locale,
    )
    db.add(user)
    db.commit()
    return user


def set_password(db: Session, username: str, password: str) -> User:
    _validate_password(password)
    user = db.execute(
        select(User).where(User.username == normalize_username(username))
    ).scalar_one_or_none()
    if user is None:
        raise UserNotFoundError()

    user.password_hash = hash_password(password)
    # Every device has to log in again with the new password.
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    db.commit()
    return user


def update_me(db: Session, user: User, locale: str) -> User:
    """The user's own settings: for now only the interface language."""
    user.locale = locale
    db.commit()
    return user
