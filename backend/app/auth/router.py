from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.auth import service
from app.auth.dependencies import SESSION_COOKIE, current_user, session_cookie
from app.auth.models import User
from app.auth.rate_limit import login_rate_limiter
from app.auth.schemas import LoginIn, UserOut, UserUpdate
from app.config import get_settings
from app.db import get_db
from app.errors import InvalidCredentialsError, TooManyLoginAttemptsError

# Reachable without a session: login and logout.
public_router = APIRouter(prefix="/auth", tags=["auth"])
# Mounted under the protected API router.
router = APIRouter(prefix="/auth", tags=["auth"])


def _cookie_params() -> dict[str, object]:
    return {
        "httponly": True,
        "samesite": "lax",
        "secure": get_settings().cookie_secure,
        "path": "/",
    }


@public_router.post("/login", response_model=UserOut)
def login(
    payload: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)
) -> User:
    ip = request.client.host if request.client else "unknown"
    if login_rate_limiter.is_blocked(ip):
        raise TooManyLoginAttemptsError()

    try:
        user, token = service.login(db, payload.username, payload.password)
    except InvalidCredentialsError:
        login_rate_limiter.record_failure(ip)
        raise

    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(service.SESSION_TTL.total_seconds()),
        **_cookie_params(),
    )
    return user


@public_router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    token: str | None = Depends(session_cookie),
    db: Session = Depends(get_db),
) -> None:
    if token:
        service.logout(db, token)
    response.delete_cookie(SESSION_COOKIE, **_cookie_params())


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)) -> User:
    return user


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: UserUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> User:
    return service.update_me(db, user, payload.locale)
