"""Housekeeping when the web service starts.

- Runs left "running" by a restart (a deploy kills the thread that ran them) are closed as
  interrupted, so the Admin buttons are not blocked. A nightly job that really is still running in
  the cron container overwrites the status when it finishes.
- Until the first national sync and the first market-history load have each succeeded, every
  start resumes whatever is missing (a deploy in the middle no longer leaves the Mercato page
  empty): national sync + geocoding + analysis, then the history since 2019 + analysis.
  ~45 minutes from scratch; progress on the Admin page. At most MAX_AUTO_ATTEMPTS tries per step,
  so a load that keeps failing can't loop: after that it's the admin's button.
"""

from __future__ import annotations

import logging
import threading
from datetime import UTC, date, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import IngestRun

log = logging.getLogger("app.first_load")

INTERRUPTED = "Interrotta da un riavvio del servizio: riprende da sola al prossimo avvio, o dalla pagina Admin."
MAX_AUTO_ATTEMPTS = 3


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


def pending_steps(db: Session) -> list[str]:
    """The parts of the first load that never succeeded: "sync" and/or "history"."""
    if not get_settings().first_load_on_start:
        return []

    def missing(kind: str) -> bool:
        ok = db.scalar(select(IngestRun.id).where(IngestRun.kind == kind, IngestRun.status == "ok").limit(1))
        tries = db.scalar(select(func.count(IngestRun.id)).where(IngestRun.kind == kind)) or 0
        return ok is None and tries < MAX_AUTO_ATTEMPTS

    return [kind for kind in ("sync", "history") if missing(kind)]


def _first_load(steps: list[str]) -> None:
    from ingest.jobs import analytics, history, nightly

    try:
        if "sync" in steps:
            nightly(scope="italy", send_alerts=False)  # sync + geocode + analysis
        if "history" in steps:
            history("italy", date(2019, 1, 1))
            analytics()
    except Exception:  # noqa: BLE001 - every step is recorded in ingest_runs
        log.exception("first load failed")


def start_first_load(steps: list[str]) -> None:
    log.info("first load incomplete, resuming in the background: %s", ", ".join(steps))
    threading.Thread(target=_first_load, args=(steps,), name="first-load", daemon=True).start()
