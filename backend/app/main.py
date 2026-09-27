from fastapi import APIRouter, Depends, FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app import models  # noqa: F401  (registers every model so cross-module FKs resolve)
from app.auth import router as auth_router
from app.auth.dependencies import current_user
from app.db import get_db
from app.errors import register_exception_handlers

app = FastAPI(title="Qoima API")
register_exception_handlers(app)

# Endpoints reachable without a session. Keep this list minimal.
public_api = APIRouter(prefix="/api")
# Every other router goes here: requires a valid session.
protected_api = APIRouter(prefix="/api", dependencies=[Depends(current_user)])


@public_api.get("/health")
def health(db: Session = Depends(get_db)) -> JSONResponse:
    try:
        db.execute(text("SELECT 1"))
    except OperationalError:
        return JSONResponse(status_code=503, content={"status": "error", "db": "unavailable"})
    return JSONResponse(status_code=200, content={"status": "ok", "db": "ok"})


public_api.include_router(auth_router.public_router)
protected_api.include_router(auth_router.router)

app.include_router(public_api)
app.include_router(protected_api)
