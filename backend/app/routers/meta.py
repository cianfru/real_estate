from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import labels
from app.auth import current_user
from app.config import get_settings
from app.db import get_db
from app.models import IngestRun, Lotto, Tribunale
from ingest.valuation import SEGMENTS

router = APIRouter(prefix="/meta", tags=["meta"], dependencies=[Depends(current_user)])


@router.get("")
def meta(db: Session = Depends(get_db)) -> dict[str, Any]:
    counts = dict(
        db.execute(
            select(Lotto.tribunale_id, func.count())
            .where(Lotto.status == "active", Lotto.merged_into_id.is_(None))
            .group_by(Lotto.tribunale_id)
        ).all()
    )
    tribunali = [
        {
            "id": t.id,
            "name": t.name,
            "short_name": t.short_name,
            "region": t.region,
            "active_for_enrichment": t.active_for_enrichment,
            "active_lots": counts.get(t.id, 0),
        }
        for t in db.scalars(select(Tribunale).order_by(Tribunale.active_for_enrichment.desc(), Tribunale.short_name))
    ]
    tipologie_in_use = [
        r[0]
        for r in db.execute(
            select(func.unnest(Lotto.categorie_bene).label("c")).where(Lotto.status == "active").distinct()
        )
    ]
    last_sync = db.scalar(
        select(IngestRun)
        .where(IngestRun.kind == "sync", IngestRun.status == "ok")
        .order_by(IngestRun.finished_at.desc())
    )
    return {
        "tribunali": tribunali,
        "categorie": labels.CATEGORIE,
        "segmenti": SEGMENTS,
        "tipologie": {
            c: labels.tipologia_label(c) for c in sorted(tipologie_in_use, key=lambda c: labels.tipologia_label(c) or c)
        },
        "modalita": labels.MODALITA,
        "tipo_vendita": labels.TIPO_VENDITA,
        "occupazione": labels.OCCUPAZIONE,
        "esiti": labels.ESITI,
        "status": labels.STATUS,
        "allegati": labels.ALLEGATI,
        "eventi": labels.EVENTI,
        "cliente_status": labels.CLIENTE_STATUS,
        "store_professional_contacts": get_settings().store_professional_contacts,
        "last_sync_at": last_sync.finished_at if last_sync else None,
        "sync_running": db.scalar(select(IngestRun.id).where(IngestRun.status == "running").limit(1)) is not None,
        "totals": {
            "active": sum(counts.values()),
        },
    }
