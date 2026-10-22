"""Market analysis endpoints: zone values for the map and the Market page overview."""

from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import current_user
from app.db import get_db
from app.models import AreaStat, IngestRun, Lotto, PriceIndex
from app.services.lotti_query import cover_url, titolo
from ingest.mapping import norm_text
from ingest.valuation import SEGMENTS

router = APIRouter(prefix="/analytics", tags=["analytics"], dependencies=[Depends(current_user)])

HIST_BINS = list(range(-60, 81, 10))  # sconto vs zone, %


def _segment(segment: str) -> str:
    if segment not in SEGMENTS:
        raise HTTPException(422, f"segmento sconosciuto: {segment}")
    return segment


@router.get("/zones")
def zones(
    segment: str = "residenziale",
    level: str = Query("hex", pattern="^(hex|hexL|comune|provincia)$"),
    bbox: str | None = None,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Zone values as GeoJSON: hexagon polygons (level=hex) or points at the zone centre."""
    q = select(AreaStat).where(AreaStat.segment == _segment(segment), AreaStat.level == level)
    if bbox:
        try:
            w, s, e, n = (float(x) for x in bbox.split(","))
        except ValueError as exc:
            raise HTTPException(422, "bbox non valido") from exc
        pad = 0.05
        q = q.where(
            AreaStat.center_lon.between(w - pad, e + pad),
            AreaStat.center_lat.between(s - pad, n + pad),
        )
    features = []
    for z in db.scalars(q.limit(8000)):
        if level in ("hex", "hexL") and z.polygon:
            geom: dict[str, Any] = {"type": "Polygon", "coordinates": [z.polygon]}
        elif z.center_lon is not None and z.center_lat is not None:
            geom = {"type": "Point", "coordinates": [z.center_lon, z.center_lat]}
        else:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": geom,
                "properties": {
                    "key": z.key,
                    "label": z.label,
                    "n": z.n,
                    "median": z.median,
                    "p25": z.p25,
                    "p75": z.p75,
                    "asta": z.asta_median,
                    "trend": z.trend_pct,
                    "n_active": z.n_active,
                    "n_opp": z.n_opportunities,
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


def _provinces(db: Session) -> list[dict[str, Any]]:
    rows = db.execute(
        select(AreaStat.key, AreaStat.label, func.sum(AreaStat.n))
        .where(AreaStat.level == "provincia")
        .group_by(AreaStat.key, AreaStat.label)
        .order_by(AreaStat.label)
    ).all()
    seen: dict[str, dict[str, Any]] = {}
    for key, lbl, n in rows:
        cur = seen.get(key)
        if cur is None or n > cur["n"]:
            seen[key] = {"key": key, "label": (lbl or key).replace("Provincia di ", ""), "n": int(n or 0)}
    return sorted(seen.values(), key=lambda x: x["label"])


def _continuous(points: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Every quarter from the first to the last, so a missing one reads as a hole, not a jump."""
    if not points:
        return []
    first, last = min(points), max(points)
    year, q = int(first[:4]), int(first[-1])
    out = []
    while True:
        qk = f"{year}-Q{q}"
        out.append(
            points.get(qk)
            or {
                "quarter": qk,
                "period_start": date(year, 3 * q - 2, 1),
                "stima": None,
                "asta": None,
                "n_stime": 0,
                "n_aste": 0,
                "n_deserte": 0,
                "gap": False,
            }
        )
        if qk >= last:
            return out
        year, q = (year + 1, 1) if q == 4 else (year, q + 1)


@router.get("/overview")
def overview(
    segment: str = "residenziale",
    area: str = Query("IT", description="IT for Italy or a provincia key from /analytics/overview provinces"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    seg = _segment(segment)
    level, key = ("italia", "IT") if area == "IT" else ("provincia", area)

    points = {
        p.quarter: {
            "quarter": p.quarter,
            "period_start": p.period_start,
            "stima": p.stima_eur_mq,
            "asta": p.asta_eur_mq,
            "n_stime": p.n_stime,
            "n_aste": p.n_aste,
            "n_deserte": p.n_deserte,
            "gap": p.gap,
        }
        for p in db.scalars(
            select(PriceIndex).where(PriceIndex.segment == seg, PriceIndex.level == level, PriceIndex.key == key)
        )
    }
    index = _continuous(points)

    zone_stat = db.scalar(select(AreaStat).where(AreaStat.segment == seg, AreaStat.level == level, AreaStat.key == key))

    # active, benchmarked lots in the area
    lq = select(Lotto).where(
        Lotto.status == "active", Lotto.merged_into_id.is_(None), Lotto.segment == seg, Lotto.eur_mq.is_not(None)
    )
    if level == "provincia":
        names = [
            p
            for p in db.scalars(select(Lotto.provincia).where(Lotto.provincia.is_not(None)).distinct())
            if norm_text(p) == key
        ]
        lq = lq.where(Lotto.provincia.in_(names or ["__none__"]))
    lots = list(db.scalars(lq))
    bench = [lot for lot in lots if lot.sconto_zona_pct is not None]
    opps = sorted((lot for lot in bench if lot.opportunity), key=lambda x: -(x.sconto_zona_pct or 0))

    hist = [{"from": b, "to": b + 10, "n": 0, "opp": 0} for b in HIST_BINS[:-1]]
    for lot in bench:
        v = max(HIST_BINS[0], min(HIST_BINS[-1] - 0.01, lot.sconto_zona_pct or 0))
        i = int((v - HIST_BINS[0]) // 10)
        hist[i]["n"] += 1
        if lot.opportunity:
            hist[i]["opp"] += 1

    scatter = [
        {
            "id": lot.id,
            "x": float(lot.zona_eur_mq) if lot.zona_eur_mq is not None else None,
            "y": float(lot.eur_mq) if lot.eur_mq is not None else None,
            "o": lot.opportunity,
            "t": f"{titolo(lot)}{f' · {lot.comune}' if lot.comune and lot.comune not in titolo(lot) else ''}",
        }
        for lot in bench[:3000]
    ]

    comuni_q = select(AreaStat).where(AreaStat.segment == seg, AreaStat.level == "comune")
    if level == "provincia":
        comuni_q = comuni_q.where(AreaStat.key.like(f"%|{key}"))
    comuni = [
        {
            "key": c.key,
            "label": c.label,
            "n": c.n,
            "median": c.median,
            "p25": c.p25,
            "p75": c.p75,
            "asta": c.asta_median,
            "trend": c.trend_pct,
            "n_active": c.n_active,
            "n_opp": c.n_opportunities,
        }
        for c in db.scalars(comuni_q.order_by(AreaStat.n.desc()).limit(40))
    ]

    sconti = sorted(lot.sconto_zona_pct for lot in bench if lot.sconto_zona_pct is not None)
    last = db.scalar(
        select(IngestRun.finished_at)
        .where(IngestRun.kind == "analytics", IngestRun.status == "ok")
        .order_by(IngestRun.finished_at.desc())
    )
    return {
        "segment": seg,
        "segments": SEGMENTS,
        "area": {
            "key": key,
            "level": level,
            "label": "Italia" if level == "italia" else (zone_stat.label if zone_stat else key),
        },
        "provinces": _provinces(db),
        "computed_at": last,
        "kpis": {
            "stima_median": zone_stat.median if zone_stat else None,
            "stima_n": zone_stat.n if zone_stat else 0,
            "stima_p25": zone_stat.p25 if zone_stat else None,
            "stima_p75": zone_stat.p75 if zone_stat else None,
            "asta_median": zone_stat.asta_median if zone_stat else None,
            "trend_pct": zone_stat.trend_pct if zone_stat else None,
            "n_active": len(lots),
            "n_benchmarked": len(bench),
            "n_opportunities": len(opps),
            "median_sconto": sconti[len(sconti) // 2] if sconti else None,
        },
        "index": index,
        "histogram": hist,
        "scatter": scatter,
        "comuni": comuni,
        "opportunities": [
            {
                "id": lot.id,
                "titolo": titolo(lot),
                "comune": lot.comune,
                "provincia": lot.provincia,
                "prezzo_base": float(lot.prezzo_base) if lot.prezzo_base is not None else None,
                "superficie_mq": lot.superficie_mq,
                "eur_mq": float(lot.eur_mq) if lot.eur_mq is not None else None,
                "zona_eur_mq": float(lot.zona_eur_mq) if lot.zona_eur_mq is not None else None,
                "zona_label": lot.zona_label,
                "sconto_zona_pct": lot.sconto_zona_pct,
                "sconto_aste_pct": lot.sconto_aste_pct,
                "zona_asta_eur_mq": float(lot.zona_asta_eur_mq) if lot.zona_asta_eur_mq is not None else None,
                "data_vendita": lot.data_vendita,
                "termine_offerte": lot.termine_offerte,
                "cover_url": cover_url(lot),
                "n_rounds": lot.n_rounds,
            }
            for lot in opps[:40]
        ],
    }
