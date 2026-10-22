"""Saved-search alerts: after each sync, match the run's events against every saved search with
alerts on, and send each user one digest. `alert_log` (unique user+event) makes sends idempotent."""

from __future__ import annotations

import html
import logging
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.labels import EVENTI
from app.models import AlertLog, Evento, Lotto, SavedSearch, User
from app.schemas import LottoFilters
from app.services.email import send_email
from app.services.lotti_query import apply_filters, titolo

log = logging.getLogger("app.alerts")

ALERT_EVENT_TYPES = ("new_lot", "new_round", "price_drop", "opportunity")


def _eur(v: Any) -> str:
    if v is None:
        return "—"
    return "€ " + f"{float(v):,.0f}".replace(",", ".")


def _when(dt: datetime | None) -> str:
    return dt.strftime("%d/%m/%Y") if dt else "—"


def run_alerts(
    db: Session, since: datetime | None = None, run_id: int | None = None, run_ids: list[int] | None = None
) -> dict[str, int]:
    since = since or datetime.now(UTC) - timedelta(days=2)
    q = select(Evento).where(Evento.tipo.in_(ALERT_EVENT_TYPES), Evento.at >= since)
    ids = [*(run_ids or []), *([run_id] if run_id is not None else [])]
    if ids:
        q = q.where(Evento.run_id.in_(ids))
    events = list(db.scalars(q))
    counts = {"events": len(events), "emails": 0, "items": 0}
    if not events:
        return counts
    lot_ids = {e.lotto_id for e in events}
    searches = db.scalars(select(SavedSearch).where(SavedSearch.alert_enabled.is_(True)))

    # user -> lotto -> (search names, events)
    digest: dict[int, dict[int, dict[str, Any]]] = defaultdict(dict)
    for s in searches:
        f = LottoFilters.model_validate(s.criteria)
        matching = set(db.scalars(apply_filters(select(Lotto.id), f).where(Lotto.id.in_(lot_ids))))
        if not matching:
            continue
        already = set(
            db.scalars(
                select(AlertLog.evento_id).where(
                    AlertLog.user_id == s.user_id, AlertLog.evento_id.in_([e.id for e in events])
                )
            )
        )
        for e in events:
            if e.lotto_id in matching and e.id not in already:
                entry = digest[s.user_id].setdefault(e.lotto_id, {"searches": set(), "events": [], "search_ids": set()})
                entry["searches"].add(s.name)
                entry["search_ids"].add(s.id)
                if e not in entry["events"]:
                    entry["events"].append(e)

    app_url = get_settings().public_app_url.rstrip("/")
    for user_id, lots in digest.items():
        user = db.get(User, user_id)
        if user is None or not user.is_active:
            continue
        rows_html, rows_txt = [], []
        for lotto_id, entry in lots.items():
            lot = db.get(Lotto, lotto_id)
            if lot is None:
                continue
            kinds = ", ".join(sorted({EVENTI.get(e.tipo, e.tipo) for e in entry["events"]}))
            link = f"{app_url}/lotti/{lot.id}"
            rows_html.append(
                f"<tr><td style='padding:12px 0;border-bottom:1px solid #e8e6e1'>"
                f"<div style='font:600 15px/1.3 Georgia,serif;color:#0b263b'>{html.escape(titolo(lot))}</div>"
                f"<div style='font:13px/1.5 -apple-system,Segoe UI,sans-serif;color:#555'>"
                f"{html.escape(lot.tribunale.short_name)} · {html.escape(kinds)} · base {_eur(lot.prezzo_base)}"
                f" · vendita {_when(lot.data_vendita)}</div>"
                f"<a href='{link}' style='font:13px -apple-system,sans-serif;color:#9a7a12'>Apri la scheda →</a>"
                f"</td></tr>"
            )
            rows_txt.append(
                f"- {titolo(lot)} ({lot.tribunale.short_name}) – {kinds} – base {_eur(lot.prezzo_base)} – {link}"
            )
        if not rows_html:
            continue
        n = len(rows_html)
        subject = f"Legal Estate · {n} novità nelle tue ricerche salvate"
        body = (
            "<div style='max-width:560px;margin:auto;padding:24px'>"
            "<div style='font:600 20px Georgia,serif;color:#0b263b'>Legal Estate</div>"
            f"<p style='font:14px -apple-system,sans-serif;color:#333'>Ciao {html.escape(user.name)}, "
            f"ecco gli aggiornamenti per le tue ricerche salvate.</p>"
            f"<table style='width:100%;border-collapse:collapse'>{''.join(rows_html)}</table>"
            "<p style='font:12px -apple-system,sans-serif;color:#888'>"
            "Puoi disattivare gli avvisi dalla pagina Ricerche salvate.</p>"
            "</div>"
        )
        text = f"Ciao {user.name},\n\n" + "\n".join(rows_txt)
        try:
            email_id = send_email(user.email, subject, body, text)
        except Exception as exc:  # noqa: BLE001
            log.error("alert email to %s failed: %s", user.email, exc)
            continue
        for entry in lots.values():
            sid = min(entry["search_ids"])
            for e in entry["events"]:
                db.add(AlertLog(user_id=user_id, evento_id=e.id, saved_search_id=sid, email_id=email_id))
        db.commit()
        counts["emails"] += 1
        counts["items"] += n
    return counts
