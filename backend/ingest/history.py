"""Market history: one slim row per PVP sale in `storico_vendite`, from search pages only.

- `backfill`: one-off, pages every sale since a date (nationally ~400 requests for 2019→today).
- the nightly list sync also feeds it (upcoming sales + the last 30 days, to pick up outcomes).
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from datetime import date
from typing import Any

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import StoricoVendita, Tribunale
from ingest.mapping import ListRow, parse_list_item
from ingest.pvp_client import PvpClient

log = logging.getLogger("ingest.history")

_UPDATABLE = (
    "comune",
    "provincia",
    "lat",
    "lon",
    "category",
    "subtype",
    "segment",
    "superficie",
    "quota_parziale",
    "prezzo_base",
    "data_vendita",
    "data_pubblicazione",
    "esito",
    "rge_numero",
    "lotto_codice",
)


def storico_values(row: ListRow) -> dict[str, Any]:
    return {
        "pvp_id": row.pvp_id,
        "trib_code": row.trib_code,
        "rge_numero": row.rge_numero,
        "lotto_codice": row.lotto_codice,
        "comune": row.comune,
        "provincia": row.provincia,
        "lat": row.lat,
        "lon": row.lon,
        "category": row.category,
        "subtype": row.categorie_bene[0] if row.categorie_bene else None,
        "segment": row.segment,
        "superficie": row.superficie,
        "quota_parziale": row.quota_parziale,
        "prezzo_base": row.prezzo_base,
        "data_vendita": row.data_vendita.date() if row.data_vendita else None,
        "data_pubblicazione": row.data_pubblicazione,
        "esito": row.esito,
    }


def upsert_storico(db: Session, rows: Iterable[ListRow]) -> int:
    values = [storico_values(r) for r in rows]
    if not values:
        return 0
    # de-duplicate within the batch (Postgres refuses two updates of one row in one statement)
    values = list({v["pvp_id"]: v for v in values}.values())
    stmt = insert(StoricoVendita).values(values)
    stmt = stmt.on_conflict_do_update(
        index_elements=[StoricoVendita.pvp_id],
        set_={k: getattr(stmt.excluded, k) for k in _UPDATABLE},
    )
    db.execute(stmt)
    return len(values)


def backfill(db: Session, client: PvpClient, scope: str, since: date) -> dict[str, int]:
    """Load every real-estate sale since `since` into storico_vendite."""
    if scope == "italy":
        filter_sets = [{"tipoLotto": "IMMOBILI"}]
    else:
        filter_sets = [
            {"tipoLotto": "IMMOBILI", "tribunale": t.name}
            for t in db.query(Tribunale).filter(Tribunale.active_for_enrichment.is_(True))
        ]
    horizon = date.today().replace(year=date.today().year + 5).isoformat()
    counts = {"rows": 0, "skipped_bad_date": 0}
    for filters in filter_sets:
        batch: list[ListRow] = []
        for item in client.iter_since(filters, since.isoformat()):
            if (item.get("dataVendita") or "9999") > horizon:
                counts["skipped_bad_date"] += 1
                continue
            batch.append(parse_list_item(item))
            if len(batch) >= 500:
                counts["rows"] += upsert_storico(db, batch)
                db.commit()
                batch = []
                log.info("history backfill: %d rows", counts["rows"])
        counts["rows"] += upsert_storico(db, batch)
        db.commit()
    counts["pvp_requests"] = client.request_count
    return counts
