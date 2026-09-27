from typing import Any

from fastapi import APIRouter, Depends, FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app import models  # noqa: F401  (registers every model so cross-module FKs resolve)
from app.auth import router as auth_router
from app.auth.dependencies import current_user
from app.catalog import router as catalog_router
from app.customers import router as customers_router
from app.db import get_db
from app.errors import ErrorOut, register_exception_handlers
from app.inventory import router as inventory_router
from app.receipts import router as receipts_router
from app.sales import router as sales_router
from app.settings import router as settings_router

app = FastAPI(title="Qoima API")
register_exception_handlers(app)

# Documents the common error body (and ErrorCode) in OpenAPI for every endpoint.
ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    "4XX": {"model": ErrorOut, "description": "Ошибка: текст для пользователя и код"}
}

# Endpoints reachable without a session. Keep this list minimal.
public_api = APIRouter(prefix="/api", responses=ERROR_RESPONSES)
# Every other router goes here: requires a valid session.
protected_api = APIRouter(
    prefix="/api", dependencies=[Depends(current_user)], responses=ERROR_RESPONSES
)


@public_api.get("/health")
def health(db: Session = Depends(get_db)) -> JSONResponse:
    try:
        db.execute(text("SELECT 1"))
    except OperationalError:
        return JSONResponse(status_code=503, content={"status": "error", "db": "unavailable"})
    return JSONResponse(status_code=200, content={"status": "ok", "db": "ok"})


public_api.include_router(auth_router.public_router)
protected_api.include_router(auth_router.router)
protected_api.include_router(catalog_router.router)
protected_api.include_router(customers_router.router)
protected_api.include_router(receipts_router.router)
protected_api.include_router(sales_router.router)
protected_api.include_router(inventory_router.router)
protected_api.include_router(settings_router.router)

app.include_router(public_api)
app.include_router(protected_api)
