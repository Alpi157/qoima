from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.attention import service
from app.attention.schemas import AttentionKey, AttentionOut, HiddenUntil
from app.auth.dependencies import current_user
from app.auth.models import User
from app.db import get_db
from app.rates.router import get_rate_session_factory
from app.rates.service import SessionFactory

router = APIRouter(prefix="/attention", tags=["attention"])


@router.get("", response_model=AttentionOut)
def attention(
    db: Session = Depends(get_db),
    session_factory: SessionFactory = Depends(get_rate_session_factory),
):
    return service.attention(db, session_factory=session_factory)


@router.post("/hide", response_model=HiddenUntil)
def hide(payload: AttentionKey, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return service.hide(db, payload.key, user.id)


@router.post("/unhide", response_model=AttentionKey)
def unhide(payload: AttentionKey, db: Session = Depends(get_db)):
    service.unhide(db, payload.key)
    return payload
