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
from app.config import Settings, get_settings
from app.customers import router as customers_router
from app.db import get_db
from app.errors import ErrorOut, register_exception_handlers
from app.inventory import router as inventory_router
from app.receipts import router as receipts_router
from app.sales import router as sales_router
from app.settings import router as settings_router

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


# Uptime monitors often check with HEAD; kept out of the schema to avoid a duplicate operation.
# Decorators apply bottom-up: GET is registered first, so a 405 here reports "Allow: GET".
@public_api.head("/health", include_in_schema=False)
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


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    docs: dict[str, Any] = {}
    if not settings.enable_docs:
        # app.openapi() still builds the schema, so `make gen-api` keeps working.
        docs = {"docs_url": None, "redoc_url": None, "openapi_url": None}
    application = FastAPI(title="Qoima API", **docs)
    register_exception_handlers(application)
    application.include_router(public_api)
    application.include_router(protected_api)
    return application


app = create_app()
