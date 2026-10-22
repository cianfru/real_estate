"""Job wrappers: each job is recorded in `ingest_runs` with counts and errors."""

from __future__ import annotations

import logging
import traceback
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import IngestRun
from ingest.pvp_client import PvpClient

log = logging.getLogger("ingest.jobs")


def run_job(
    kind: str, scope: str | None, fn: Callable[[Session, IngestRun], dict[str, Any] | tuple[dict[str, Any], list[str]]]
) -> IngestRun:
    db = SessionLocal()
    run = IngestRun(kind=kind, scope=scope, status="running")
    db.add(run)
    db.commit()
    log.info("run #%s %s (%s) started", run.id, kind, scope)
    try:
        res = fn(db, run)
        counts, errors = res if isinstance(res, tuple) else (res, [])
        run.counts, run.errors = counts, errors[:200]
        run.status = "ok"
    except Exception as e:
        db.rollback()
        run.status = "failed"
        run.errors = [f"{type(e).__name__}: {e}", traceback.format_exc()[-3000:]]
        log.exception("run #%s %s failed", run.id, kind)
        raise
    finally:
        run.finished_at = datetime.now(UTC)
        db.add(run)
        db.commit()
        log.info("run #%s %s finished: %s %s", run.id, kind, run.status, run.counts)
        db.close()
    return run


def sync(scope: str, with_details: bool = True) -> IngestRun:
    from ingest.sync import Syncer

    def _do(db: Session, run: IngestRun) -> tuple[dict[str, Any], list[str]]:
        client = PvpClient()
        try:
            res = Syncer(db, client, run=run).full_sync(scope, with_details=with_details)
        finally:
            client.close()
        return res.counts, res.errors

    return run_job("sync", scope, _do)


def geocode(limit: int | None = None) -> IngestRun:
    from ingest.geocode import geocode_missing

    return run_job("geocode", None, lambda db, run: geocode_missing(db, limit=limit, run=run))


def alerts(sync_run_id: int | None = None) -> IngestRun:
    from app.services.alerts import run_alerts

    return run_job("alerts", None, lambda db, run: run_alerts(db, run_id=sync_run_id))


def nightly(scope: str = "italy", send_alerts: bool = True) -> None:
    """The scheduled job: sync, geocode what PVP left unplaced, then alerts for this run's events."""
    run = sync(scope)
    try:
        geocode()
    except Exception:  # noqa: BLE001 - geocoding failures must not block alerts
        log.exception("geocode failed")
    if send_alerts:
        alerts(run.id)
