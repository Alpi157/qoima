from fastapi import Depends
from fastapi.security import APIKeyCookie
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.service import get_user_by_token
from app.db import get_db
from app.errors import NotAuthenticatedError

SESSION_COOKIE = "qoima_session"

# Declares the cookie in OpenAPI; auto_error=False so a missing cookie gives our own 401.
session_cookie = APIKeyCookie(name=SESSION_COOKIE, auto_error=False)


def current_user(
    token: str | None = Depends(session_cookie), db: Session = Depends(get_db)
) -> User:
    user = get_user_by_token(db, token) if token else None
    if user is None:
        raise NotAuthenticatedError()
    return user
