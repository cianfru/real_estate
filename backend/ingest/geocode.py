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


# A query is free text, or a dict of Nominatim structured-search fields (street, city, ...).
Query = str | dict[str, str]


class Geocoder(Protocol):
    name: str

    def geocode(self, query: Query) -> GeoResult | None: ...


class NominatimGeocoder:
    name = "nominatim"

    def __init__(self, settings: Settings | None = None, transport: httpx.BaseTransport | None = None):
        self.settings = settings or get_settings()
        self.http = httpx.Client(timeout=30, headers={"User-Agent": self.settings.pvp_user_agent}, transport=transport)
        self._last = 0.0

    def _get(self, params: dict[str, str]) -> httpx.Response:
        for attempt in range(2):
            wait = 1.05 - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            r = self.http.get(self.settings.nominatim_url, params=params)
            if r.status_code == 429 and attempt == 0:
                log.warning("nominatim 429, backing off 30 s")
                time.sleep(30)
                continue
            return r
        return r

    def geocode(self, query: Query) -> GeoResult | None:
        params = {"format": "jsonv2", "countrycodes": "it", "limit": "1"}
        params.update({"q": query} if isinstance(query, str) else query)
        if self.settings.nominatim_email:
            params["email"] = self.settings.nominatim_email
        try:
            r = self._get(params)
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
    r"\bs\.?\s*n\.?\s*c\.?(?=\W|$)",
    r"\bsnc\b",
    r"\blotto\s+\w+",
    r"\bn\.?\s*civ(ico)?\.?(\s+presunto)?",
    r"\bsez\.\s*\w+",
    r"\bpiano\s+\S+",
    r"\b(int(erno)?|scala|sc\.)\s*\.?\s*\w+",
    r"\bn\.\s*(?=\d)",
    r"\bcivico\b",
    r"\(.*?\)",
]


_STREET_WORDS = r"(via|viale|vicolo|piazza|piazzale|corso|largo|strada|localita|località|contrada|borgo|riviera)"


def clean_street(via: str | None, comune: str | None, cap: str | None) -> str:
    """The street part of PVP's free-text 'via', normalised for Nominatim (lower case)."""
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
    # "località X, in via Y 11" / "lungo via Y" / "nelle vicinanze di via Y": keep the street
    m = re.search(r"(?:\b(?:in|lungo|nelle vicinanze di)\s+)(" + _STREET_WORDS + r"\b.*)", s)
    if m:
        s = m.group(1)
    # several streets ("via A 1 e via B 9", "via A, piazza B, viale C"): keep the first
    s = re.split(r"\s+e\s+(?=" + _STREET_WORDS + r"\b)|\s+-\s+", s)[0]
    s = re.sub(r",\s*(?=\d)", " ", s)  # "via atene, 88" -> "via atene 88"
    parts = [p.strip() for p in s.split(",") if p.strip()]
    if len(parts) > 1:
        s = next((p for p in parts if re.match(_STREET_WORDS, p)), parts[0])
    for pat, rep in _ABBREV:
        s = re.sub(pat, rep, s)
    for pat in _NOISE:
        s = re.sub(pat, " ", s)
    s = re.sub(r"(\d+)(?:\s*-\s*\d+)+", r"\1", s)  # "3-6-8" -> "3"
    return re.sub(r"\s+", " ", s).strip(" ,.-")


def normalise_address(via: str | None, comune: str | None, provincia: str | None, cap: str | None) -> str | None:
    """Free-text Nominatim query from PVP's address fields."""
    if not comune and not via:
        return None
    s = clean_street(via, comune, cap)
    parts = [p for p in (s, " ".join(x for x in (cap, comune) if x), provincia, "Italia") if p]
    return ", ".join(parts)


def street_queries(
    via: str | None, comune: str | None, provincia: str | None, cap: str | None
) -> list[tuple[Query, float]]:
    """Attempts in order, each with the maximum confidence it can earn: free text, structured
    street + city, then the street without its civic number (road level)."""
    street = clean_street(via, comune, cap)
    if not street or not comune:
        return []
    out: list[tuple[Query, float]] = []
    free = normalise_address(via, comune, provincia, cap)
    if free:
        out.append((free, 1.0))
    # structured search wants "<housenumber> <street>"
    m = re.match(r"^(.*?)\s+(\d+\s*/?\s*[a-z]?)$", street)
    name, number = (m.group(1), m.group(2).replace(" ", "")) if m else (street, None)
    out.append(({"street": f"{number} {name}" if number else name, "city": comune, "country": "Italia"}, 1.0))
    if number:
        out.append(({"street": name, "city": comune, "country": "Italia"}, 0.6))
    return out


def comune_query(comune: str | None, provincia: str | None) -> str | None:
    if not comune:
        return None
    return ", ".join(x for x in (comune, provincia, "Italia") if x)


# ------------------------------------------------------------------ runner


def _cache_key(query: Query) -> str:
    if isinstance(query, str):
        return query.lower()
    return "s:" + "|".join(f"{k}={v.lower()}" for k, v in sorted(query.items()))


def _cached(db: Session, geocoder: Geocoder, query: Query, source: str) -> GeoResult | None:
    key = _cache_key(query)
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
            for query, max_conf in street_queries(lot.indirizzo, lot.comune, lot.provincia, lot.cap):
                res = _cached(db, geocoder, query, geocoder.name)
                if res is not None:
                    res = GeoResult(res.lat, res.lon, min(res.confidence, max_conf))
                    break
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
