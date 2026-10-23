"""Housekeeping when the web service starts.

- Runs left "running" by a restart (a deploy kills the thread that ran them) are closed as
  interrupted, so the Admin buttons are not blocked. A nightly job that really is still running in
  the cron container overwrites the status when it finishes.
- A deployment that has never loaded PVP starts the first full load by itself: national sync,
  geocoding, market history, analysis. ~35 minutes; progress on the Admin page.
"""

from __future__ import annotations

import logging
import threading
from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import IngestRun

log = logging.getLogger("app.first_load")

INTERRUPTED = "Interrotta da un riavvio del servizio: avviala di nuovo dalla pagina Admin."


def close_interrupted_runs(db: Session) -> int:
    rows = db.scalars(select(IngestRun).where(IngestRun.status == "running")).all()
    for run in rows:
        run.status = "failed"
        run.finished_at = datetime.now(UTC)
        run.errors = [*(run.errors or []), INTERRUPTED]
    db.commit()
    if rows:
        log.warning("closed %d runs interrupted by a restart", len(rows))
    return len(rows)


def needs_first_load(db: Session) -> bool:
    return (
        get_settings().first_load_on_start
        and db.scalar(select(IngestRun.id).where(IngestRun.kind == "sync").limit(1)) is None
    )


def _first_load() -> None:
    from ingest.jobs import analytics, history, nightly

    try:
        nightly(scope="italy", send_alerts=False)  # sync + geocode + analytics (skipped without history)
        history("italy", date(2019, 1, 1))
        analytics()
    except Exception:  # noqa: BLE001 - every step is recorded in ingest_runs
        log.exception("first load failed")


def start_first_load() -> None:
    log.info("empty database: starting the first PVP load in the background")
    threading.Thread(target=_first_load, name="first-load", daemon=True).start()
