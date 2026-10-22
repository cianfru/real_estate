import logging
import threading
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import admin_user, current_user
from app.db import get_db
from app.models import Evento, IngestRun, Lotto, Tribunale, User, Vendita
from app.schemas import IngestRunOut, TribunaleOut

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(current_user)])
log = logging.getLogger("app.admin")


@router.get("/runs", response_model=list[IngestRunOut])
def runs(limit: int = 30, db: Session = Depends(get_db)) -> list[IngestRun]:
    return list(db.scalars(select(IngestRun).order_by(IngestRun.started_at.desc()).limit(limit)))


@router.get("/stats")
def stats(db: Session = Depends(get_db)) -> dict[str, Any]:
    by_status = dict(db.execute(select(Lotto.status, func.count()).group_by(Lotto.status)).all())
    active = Lotto.status == "active"
    return {
        "lotti_by_status": by_status,
        "vendite": db.scalar(select(func.count(Vendita.id))),
        "active_with_coords": db.scalar(select(func.count()).where(active, Lotto.geom.is_not(None))),
        "active_without_coords": db.scalar(select(func.count()).where(active, Lotto.geom.is_(None))),
        "active_with_detail": db.scalar(select(func.count()).where(active, Lotto.has_detail.is_(True))),
        "approx_coords": db.scalar(select(func.count()).where(active, Lotto.geocode_source == "comune")),
        "eventi_7d": dict(
            db.execute(
                select(Evento.tipo, func.count())
                .where(Evento.at > datetime.now(UTC) - timedelta(days=7))
                .group_by(Evento.tipo)
            ).all()
        ),
        "by_tribunale": [
            {"id": r[0], "name": r[1], "active": r[2], "count": r[3]}
            for r in db.execute(
                select(Tribunale.id, Tribunale.short_name, Tribunale.active_for_enrichment, func.count(Lotto.id))
                .join(Lotto, Lotto.tribunale_id == Tribunale.id)
                .where(active)
                .group_by(Tribunale.id)
                .order_by(func.count(Lotto.id).desc())
                .limit(30)
            )
        ],
    }


def _run_in_background(scope: str) -> None:
    from ingest.jobs import nightly

    try:
        nightly(scope=scope, send_alerts=False)
    except Exception:  # noqa: BLE001 - recorded in ingest_runs by the job itself
        log.exception("manual sync failed")


@router.post("/sync", status_code=202)
def trigger_sync(scope: str = "veneto", db: Session = Depends(get_db), _: User = Depends(admin_user)) -> dict[str, str]:
    if scope not in ("veneto", "italy"):
        raise HTTPException(422, "scope deve essere veneto o italy")
    running = db.scalar(
        select(IngestRun).where(
            IngestRun.status == "running", IngestRun.started_at > datetime.now(UTC) - timedelta(hours=3)
        )
    )
    if running:
        raise HTTPException(409, f"Una sincronizzazione è già in corso (run #{running.id})")
    threading.Thread(target=_run_in_background, args=(scope,), daemon=True).start()
    return {"status": "started", "scope": scope}


@router.get("/tribunali", response_model=list[TribunaleOut])
def tribunali(db: Session = Depends(get_db)) -> list[Tribunale]:
    return list(db.scalars(select(Tribunale).order_by(Tribunale.active_for_enrichment.desc(), Tribunale.short_name)))


@router.patch("/tribunali/{tid}", response_model=TribunaleOut)
def set_tribunale(tid: int, active: bool, db: Session = Depends(get_db), _: User = Depends(admin_user)) -> Tribunale:
    t = db.get(Tribunale, tid)
    if t is None:
        raise HTTPException(404, "Tribunale non trovato")
    t.active_for_enrichment = active
    db.commit()
    return t
