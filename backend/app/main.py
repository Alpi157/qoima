from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import register_exception_handlers

app = FastAPI(title="Qoima API")
register_exception_handlers(app)


@app.get("/api/health")
def health(db: Session = Depends(get_db)) -> JSONResponse:
    try:
        db.execute(text("SELECT 1"))
    except OperationalError:
        return JSONResponse(status_code=503, content={"status": "error", "db": "unavailable"})
    return JSONResponse(status_code=200, content={"status": "ok", "db": "ok"})
