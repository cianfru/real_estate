from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import current_user
from app.db import get_db
from app.models import Lotto, SavedSearch, User
from app.schemas import LottoFilters, SavedSearchIn, SavedSearchOut
from app.services.lotti_query import apply_filters

router = APIRouter(prefix="/saved-searches", tags=["saved searches"])


def _out(db: Session, s: SavedSearch, with_counts: bool = True) -> SavedSearchOut:
    match = new7 = None
    if with_counts:
        f = LottoFilters.model_validate(s.criteria)
        match = db.scalar(apply_filters(select(func.count(Lotto.id)), f))
        f7 = f.model_copy(update={"new_days": 7})
        new7 = db.scalar(apply_filters(select(func.count(Lotto.id)), f7))
    return SavedSearchOut(
        id=s.id,
        name=s.name,
        criteria=s.criteria,
        alert_enabled=s.alert_enabled,
        created_at=s.created_at,
        match_count=match,
        new_last_7d=new7,
    )


def _own(db: Session, sid: int, user: User) -> SavedSearch:
    s = db.get(SavedSearch, sid)
    if s is None or s.user_id != user.id:
        raise HTTPException(404, "Ricerca non trovata")
    return s


@router.get("", response_model=list[SavedSearchOut])
def list_searches(db: Session = Depends(get_db), user: User = Depends(current_user)) -> list[SavedSearchOut]:
    rows = db.scalars(select(SavedSearch).where(SavedSearch.user_id == user.id).order_by(SavedSearch.created_at.desc()))
    return [_out(db, s) for s in rows]


@router.post("", response_model=SavedSearchOut)
def create_search(
    body: SavedSearchIn, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> SavedSearchOut:
    crit = body.criteria.model_dump(mode="json", exclude_none=True)
    crit.pop("bbox", None)  # a saved search follows its filters, not the map viewport
    s = SavedSearch(
        user_id=user.id, name=body.name, criteria=crit, polygon=body.criteria.polygon, alert_enabled=body.alert_enabled
    )
    db.add(s)
    db.commit()
    return _out(db, s)


@router.put("/{sid}", response_model=SavedSearchOut)
def update_search(
    sid: int, body: SavedSearchIn, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> SavedSearchOut:
    s = _own(db, sid, user)
    crit = body.criteria.model_dump(mode="json", exclude_none=True)
    crit.pop("bbox", None)
    s.name, s.criteria, s.polygon, s.alert_enabled = body.name, crit, body.criteria.polygon, body.alert_enabled
    s.updated_at = datetime.now(UTC)
    db.commit()
    return _out(db, s)


@router.patch("/{sid}/alert", response_model=SavedSearchOut)
def toggle_alert(
    sid: int, enabled: bool, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> SavedSearchOut:
    s = _own(db, sid, user)
    s.alert_enabled = enabled
    db.commit()
    return _out(db, s)


@router.delete("/{sid}", status_code=204)
def delete_search(sid: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> None:
    db.delete(_own(db, sid, user))
    db.commit()
