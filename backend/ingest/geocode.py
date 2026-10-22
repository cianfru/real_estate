"""Geocoding for lots PVP did not place on the map.

Nominatim (public instance, max 1 req/s, results cached forever in `geocode_cache`).
The `Geocoder` protocol lets a paid provider be swapped in without touching the callers.
"""

from __future__ import annotations

import logging
import re
import time
from collections import Counter
from dataclasses import dataclass
from typing import Protocol

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.models import Evento, GeocodeCache, IngestRun, Lotto, Tribunale
from ingest.mapping import valid_coords

log = logging.getLogger("ingest.geocode")


@dataclass
class GeoResult:
    lat: float
    lon: float
    confidence: float


class Geocoder(Protocol):
    name: str

    def geocode(self, query: str) -> GeoResult | None: ...


class NominatimGeocoder:
    name = "nominatim"

    def __init__(self, settings: Settings | None = None, transport: httpx.BaseTransport | None = None):
        self.settings = settings or get_settings()
        self.http = httpx.Client(timeout=30, headers={"User-Agent": self.settings.pvp_user_agent}, transport=transport)
        self._last = 0.0

    def geocode(self, query: str) -> GeoResult | None:
        wait = 1.05 - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()
        params = {"q": query, "format": "jsonv2", "countrycodes": "it", "limit": "1"}
        if self.settings.nominatim_email:
            params["email"] = self.settings.nominatim_email
        try:
            r = self.http.get(self.settings.nominatim_url, params=params)
            r.raise_for_status()
            data = r.json()
        except (httpx.HTTPError, ValueError) as e:
            log.warning("nominatim failed for %r: %s", query, e)
            raise
        if not data:
            return None
        hit = data[0]
        ll = valid_coords(hit.get("lat"), hit.get("lon"))
        if not ll:
            return None
        kind = hit.get("addresstype") or hit.get("type") or ""
        if kind in ("house", "building", "house_number"):
            conf = 0.85
        elif kind in ("road", "street", "residential", "pedestrian"):
            conf = 0.65
        elif kind in ("hamlet", "village", "suburb", "neighbourhood", "quarter", "isolated_dwelling"):
            conf = 0.45
        else:
            conf = 0.35
        return GeoResult(ll[0], ll[1], conf)


# ------------------------------------------------------------------ address normalisation

_ABBREV = [
    (r"\bv\.\s*le\b\.?", "viale"),
    (r"\bv\.\s*lo\b\.?", "vicolo"),
    (r"\bp\.\s*zza\b\.?", "piazza"),
    (r"\bp\.\s*za\b\.?", "piazza"),
    (r"\bp\.\s*le\b\.?", "piazzale"),
    (r"\bc\.\s*so\b\.?", "corso"),
    (r"\bl\.\s*go\b\.?", "largo"),
    (r"\bloc\.", "localita"),
    (r"\bfraz\.", ""),
    (r"\bfrazione\b", ""),
    (r"\bv\.(?=\s)", "via"),
    (r"\bs\.\s*s\.\s*(?=\d)", "strada statale "),
    (r"\bs\.\s*p\.\s*(?=\d)", "strada provinciale "),
]
_NOISE = [
    r"\b(snc|s\.n\.c\.)\b",
    r"\bpiano\s+\S+",
    r"\b(int(erno)?|scala|sc\.)\s*\.?\s*\w+",
    r"\bn\.\s*(?=\d)",
    r"\bcivico\b",
    r"\(.*?\)",
]


def normalise_address(via: str | None, comune: str | None, provincia: str | None, cap: str | None) -> str | None:
    """Build a Nominatim query from PVP's free-text address fields."""
    if not comune and not via:
        return None
    street = (via or "").strip()
    # PVP sometimes stores a full Google-formatted address in 'via': keep only the street part.
    if comune and comune.lower() in street.lower() and "," in street:
        keep: list[str] = []
        for part in street.split(","):
            low = part.strip().lower()
            if comune.lower() in low or (cap and cap in low) or low in ("italia", "italy"):
                break
            keep.append(part.strip())
        street = ", ".join(keep) or street.split(",")[0]
    s = street.lower()
    for pat, rep in _ABBREV:
        s = re.sub(pat, rep, s)
    for pat in _NOISE:
        s = re.sub(pat, " ", s)
    s = re.sub(r"\s+", " ", s).strip(" ,.-")
    parts = [p for p in (s, " ".join(x for x in (cap, comune) if x), provincia, "Italia") if p]
    return ", ".join(parts)


def comune_query(comune: str | None, provincia: str | None) -> str | None:
    if not comune:
        return None
    return ", ".join(x for x in (comune, provincia, "Italia") if x)


# ------------------------------------------------------------------ runner


def _cached(db: Session, geocoder: Geocoder, query: str, source: str) -> GeoResult | None:
    key = query.lower()
    hit = db.get(GeocodeCache, key)
    if hit is not None:
        return GeoResult(hit.lat, hit.lon, hit.confidence or 0) if hit.lat is not None and hit.lon is not None else None
    res = geocoder.geocode(query)
    db.add(
        GeocodeCache(
            address=key,
            lat=res.lat if res else None,
            lon=res.lon if res else None,
            source=source,
            confidence=res.confidence if res else None,
        )
    )
    db.flush()
    return res


def geocode_missing(
    db: Session,
    geocoder: Geocoder | None = None,
    limit: int | None = None,
    run: IngestRun | None = None,
    active_only: bool = False,
) -> dict[str, int]:
    settings = get_settings()
    geocoder = geocoder or NominatimGeocoder(settings)
    counts: Counter[str] = Counter()
    # Active tribunali first (they must be fully placed), then by sale date; the national backlog
    # drains over a few nights within GEOCODE_LIMIT.
    q = (
        select(Lotto)
        .join(Tribunale, Lotto.tribunale_id == Tribunale.id)
        .where(Lotto.geom.is_(None), Lotto.status.in_(("active", "unknown")))
    )
    if active_only:
        q = q.where(Tribunale.active_for_enrichment.is_(True))
    q = q.order_by(Tribunale.active_for_enrichment.desc(), Lotto.data_vendita.asc().nulls_last()).limit(
        limit or settings.geocode_limit
    )
    for lot in db.scalars(q):
        counts["candidates"] += 1
        try:
            res, source = None, geocoder.name
            query = normalise_address(lot.indirizzo, lot.comune, lot.provincia, lot.cap)
            if query and lot.indirizzo:
                res = _cached(db, geocoder, query, geocoder.name)
            if res is None:
                cq = comune_query(lot.comune, lot.provincia)
                if cq:
                    res = _cached(db, geocoder, cq, "comune")
                    if res:
                        res = GeoResult(res.lat, res.lon, 0.2)
                        source = "comune"
        except httpx.HTTPError:
            counts["errors"] += 1
            continue
        if res is None:
            counts["not_found"] += 1
            continue
        lot.geom = f"SRID=4326;POINT({res.lon} {res.lat})"
        lot.geocode_source = source
        lot.geocode_confidence = res.confidence
        db.add(
            Evento(
                lotto_id=lot.id,
                run_id=run.id if run else None,
                tipo="geocoded",
                new={"source": source, "confidence": res.confidence},
            )
        )
        counts[f"geocoded_{source}"] += 1
        db.commit()
    db.commit()
    return dict(counts)
