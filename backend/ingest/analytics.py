"""Market analysis: zone values, price index and opportunities. See docs/market-analysis.md.

Idea in one paragraph: in an Italian judicial auction the first round's base price is the court
expert's valuation (perizia). So first-round price / m² is an expert-appraised €/m², and with
the whole PVP history we have tens of thousands of them, geolocated. Their median per zone and
segment is the zone's appraised value. A lot whose *current* base price per m² is far below the
appraised value of its zone is an opportunity; one that is merely cheap because its own appraisal
was low (poor condition) shows that too, since we keep both numbers.
"""

from __future__ import annotations

import logging
import statistics
from bisect import bisect_left, insort
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from geoalchemy2 import Geometry
from sqlalchemy import cast, delete, func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import AreaStat, Evento, IngestRun, Lotto, PriceIndex, StoricoVendita, Tribunale, Vendita
from ingest.mapping import norm_text
from ingest.valuation import (
    SEGMENTS,
    extract_surface,
    hex_center,
    hex_key,
    hex_polygon,
    is_partial_ownership,
    plausible,
    quantile,
    segment_of,
)

log = logging.getLogger("ingest.analytics")

OPPORTUNITY_SEGMENTS = {"residenziale", "commerciale", "industriale", "box"}
# hex = ~2 km cells, hexL = ~8 km cells (4x the size): the map shows hexL when zoomed out and
# the benchmark falls back hex -> comune -> hexL -> provincia until there are enough comparables.
MIN_N = {"hex": 6, "comune": 6, "hexL": 8, "provincia": 8, "italia": 20}
DISPLAY_MIN_N = {"hex": 3, "comune": 3, "hexL": 4, "provincia": 5, "italia": 10}
HEX_LEVELS = ("hex", "hexL")
GROUP_GAP_DAYS = 3 * 365  # same RGE+lot+comune with a gap this long = a different procedure
# A first sale only counts as an appraisal if we could have seen the procedure's earlier rounds:
# 90% of re-offers come within ~13 months of the previous round.
ROUND_LOOKBACK_DAYS = 365
# PVP coverage holes (Feb 2025 – Mar 2026 has ~1% of the usual sales, see pvp-api.md): a month
# with fewer sales than this share of a normal month is "blind".
BLIND_SHARE = 0.1  # the 2020 lockdown months sit at ~17-20%: real, just quiet
BLIND_MIN_NORMAL = 50  # below this many sales in a normal month the history is too thin to tell
INDEX_MIN_N = 8  # price index: observations in the rolling window
INDEX_MIN_OWN = 3  # ... of which in the quarter itself


@dataclass
class Obs:
    value: float  # €/m²
    group: str  # base lot key, for leave-one-out
    day: date


@dataclass
class Zone:
    segment: str
    level: str
    key: str
    label: str
    obs: list[Obs] = field(default_factory=list)  # appraisals (first rounds)
    asta_obs: list[Obs] = field(default_factory=list)  # every round's base price
    sorted_asta: list[float] = field(default_factory=list)
    lons: list[float] = field(default_factory=list)
    lats: list[float] = field(default_factory=list)
    sorted_vals: list[float] = field(default_factory=list)
    groups: set[str] = field(default_factory=set)
    active_vals: list[float] = field(default_factory=list)
    n_active: int = 0
    n_opp: int = 0


def _quarter(d: date) -> tuple[str, date]:
    q = (d.month - 1) // 3 + 1
    return f"{d.year}-Q{q}", date(d.year, 3 * (q - 1) + 1, 1)


def _quarter_start(qk: str) -> date:
    return date(int(qk[:4]), 3 * int(qk[-1]) - 2, 1)


def _quarter_range(first: str, last: str) -> list[str]:
    out, year, q = [], int(first[:4]), int(first[-1])
    while (qk := f"{year}-Q{q}") <= last:
        out.append(qk)
        year, q = (year + 1, 1) if q == 4 else (year, q + 1)
    return out


def _next_month(m: date) -> date:
    return date(m.year + (m.month == 12), m.month % 12 + 1, 1)


def blind_months(per_month: Counter[date], today: date) -> set[date]:
    """Months in which PVP published (almost) no sales. August is quiet every year (court
    holidays) and only counts when the months around it are blind too."""
    if not per_month:
        return set()
    months, m, last = [], min(per_month), today.replace(day=1)
    while m <= last:
        months.append(m)
        m = _next_month(m)
    if not months:
        return set()
    normal = statistics.median(per_month.get(m, 0) for m in months)
    if normal < BLIND_MIN_NORMAL:
        return set()
    low = {m for m in months if per_month.get(m, 0) < normal * BLIND_SHARE}
    return {m for m in low if m.month != 8 or (m.replace(month=7) in low and m.replace(month=9) in low)}


def _base_group(trib: str, rge: str | None, lotto: str | None, comune: str | None) -> str:
    return f"{trib}|{rge or '?'}|{lotto or '?'}|{norm_text(comune)}"


def _stats(vals: list[float]) -> tuple[float, float, float]:
    return quantile(vals, 0.5), quantile(vals, 0.25), quantile(vals, 0.75)


def _without(sorted_vals: list[float], remove: list[float]) -> list[float]:
    out = list(sorted_vals)
    for v in remove:
        i = bisect_left(out, v)
        if i < len(out) and out[i] == v:
            out.pop(i)
    return out


def run_analytics(db: Session, run: IngestRun | None = None) -> dict[str, Any]:
    s = get_settings()
    size = s.hex_size_m
    size_l = s.hex_size_m * 4
    counts: Counter[str] = Counter()
    today = date.today()
    window_start = today - timedelta(days=365 * s.analytics_years)

    data_start = db.scalar(select(func.min(StoricoVendita.data_vendita)))
    if data_start is None:
        return {"skipped": 1, "reason_no_history": 1}
    # A group's first sale is its first round only if we could have seen earlier ones.
    first_round_ok_from = data_start + timedelta(days=365)

    # Surfaces from PVP details beat surfaces parsed from text.
    detail_surface = dict(
        db.execute(
            select(Vendita.pvp_id, Lotto.superficie_mq)
            .join(Lotto, Vendita.lotto_id == Lotto.id)
            .where(Lotto.superficie_source == "pvp", Lotto.superficie_mq.is_not(None))
        ).all()
    )

    # ---------------------------------------------------------------- history -> groups
    rows = db.execute(
        select(
            StoricoVendita.pvp_id,
            StoricoVendita.trib_code,
            StoricoVendita.rge_numero,
            StoricoVendita.lotto_codice,
            StoricoVendita.comune,
            StoricoVendita.provincia,
            StoricoVendita.lat,
            StoricoVendita.lon,
            StoricoVendita.segment,
            StoricoVendita.superficie,
            StoricoVendita.quota_parziale,
            StoricoVendita.prezzo_base,
            StoricoVendita.data_vendita,
            StoricoVendita.esito,
        )
        .where(StoricoVendita.segment.is_not(None), StoricoVendita.data_vendita.is_not(None))
        .order_by(StoricoVendita.data_vendita)
    ).all()
    counts["history_rows"] = len(rows)

    per_month: Counter[date] = Counter(r.data_vendita.replace(day=1) for r in rows if r.data_vendita <= today)
    blind = sorted(blind_months(per_month, today))
    counts["blind_months"] = len(blind)
    blind_quarters = {_quarter(m)[0] for m in blind if sum(_quarter(b)[0] == _quarter(m)[0] for b in blind) >= 2}
    trusted_cache: dict[date, bool] = {}

    def trusted_first_round(d: date) -> bool:
        """Is a group's first sale on day d really its first round (= the appraisal)?"""
        ok = trusted_cache.get(d)
        if ok is None:
            lo = (d - timedelta(days=ROUND_LOOKBACK_DAYS)).replace(day=1)
            ok = trusted_cache[d] = d >= first_round_ok_from and not any(lo <= m <= d for m in blind)
        return ok

    # comune centroids, to place sales without coordinates at comune/provincia level
    cpos: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for r in rows:
        if r.lat is not None and r.lon is not None and r.comune:
            cpos[f"{norm_text(r.comune)}|{norm_text(r.provincia)}"].append((r.lon, r.lat))

    groups: dict[str, list[Any]] = defaultdict(list)
    for r in rows:
        base = _base_group(r.trib_code, r.rge_numero, r.lotto_codice, r.comune)
        seq = groups[base]
        if seq and (r.data_vendita - seq[-1][-1].data_vendita).days > GROUP_GAP_DAYS:
            seq.append([r])
        elif seq:
            seq[-1].append(r)
        else:
            seq.append([r])

    zones: dict[tuple[str, str, str], Zone] = {}

    def zone(seg: str, level: str, key: str, label: str) -> Zone:
        z = zones.get((seg, level, key))
        if z is None:
            z = zones[(seg, level, key)] = Zone(seg, level, key, label)
        return z

    stime_by_q: dict[tuple[str, str, str, str], list[float]] = defaultdict(list)
    aste_by_q: dict[tuple[str, str, str, str], list[float]] = defaultdict(list)
    deserte_by_q: Counter[tuple[str, str, str, str]] = Counter()

    # first-round price of the most recent procedure per lot key: the true appraisal even for
    # lots whose earlier rounds the operational tables never saw
    first_round_price: dict[str, float] = {}
    for base, seqs in groups.items():
        last_seq = seqs[-1]
        if last_seq[0].data_vendita >= first_round_ok_from and last_seq[0].prezzo_base is not None:
            first_round_price[base] = float(last_seq[0].prezzo_base)
        for seq in seqs:
            first = seq[0]
            seg = first.segment
            surface = next((detail_surface[x.pvp_id] for x in seq if x.pvp_id in detail_surface), None)
            surface = surface or next((x.superficie for x in seq if x.superficie), None)
            if not surface or any(x.quota_parziale for x in seq):
                counts["groups_without_surface_or_partial"] += 1
                continue
            prov = norm_text(first.provincia)
            ckey = f"{norm_text(first.comune)}|{prov}"
            # auction prices: every round
            for x in seq:
                if x.prezzo_base is None:
                    continue
                v = float(x.prezzo_base) / surface
                if not plausible(seg, surface, v):
                    continue
                if x.data_vendita >= window_start:
                    aob = Obs(v, base, x.data_vendita)
                    if first.lon is not None and first.lat is not None:
                        zone(seg, "hex", hex_key(first.lon, first.lat, size), "").asta_obs.append(aob)
                        zone(seg, "hexL", hex_key(first.lon, first.lat, size_l), "").asta_obs.append(aob)
                    if first.comune:
                        zone(seg, "comune", ckey, _comune_label(first.comune, first.provincia)).asta_obs.append(aob)
                    if prov:
                        zone(seg, "provincia", prov, f"Provincia di {first.provincia}").asta_obs.append(aob)
                qk = _quarter(x.data_vendita)[0]
                for lvl, key in (("italia", "IT"), ("provincia", prov)):
                    if key:
                        aste_by_q[(seg, lvl, key, qk)].append(v)
                        if x.esito == "ASDES":
                            deserte_by_q[(seg, lvl, key, qk)] += 1
            # appraisal: first round only, and only if it really is the first one
            if first.prezzo_base is None:
                continue
            if not trusted_first_round(first.data_vendita):
                if first.data_vendita >= first_round_ok_from:
                    counts["appraisals_after_blind_months"] += 1
                continue
            v = float(first.prezzo_base) / surface
            if not plausible(seg, surface, v):
                counts["implausible"] += 1
                continue
            counts["appraisals"] += 1
            qk = _quarter(first.data_vendita)[0]
            for lvl, key in (("italia", "IT"), ("provincia", prov)):
                if key:
                    stime_by_q[(seg, lvl, key, qk)].append(v)
            if first.data_vendita < window_start:
                continue
            ob = Obs(v, base, first.data_vendita)
            lon, lat = first.lon, first.lat
            if lon is not None and lat is not None:
                zone(seg, "hex", hex_key(lon, lat, size), "").obs.append(ob)
                zone(seg, "hexL", hex_key(lon, lat, size_l), "").obs.append(ob)
            elif ckey in cpos:
                lon = statistics.fmean(p[0] for p in cpos[ckey])
                lat = statistics.fmean(p[1] for p in cpos[ckey])
            if first.comune:
                z = zone(seg, "comune", ckey, _comune_label(first.comune, first.provincia))
                z.obs.append(ob)
                if lon is not None and lat is not None:
                    z.lons.append(lon)
                    z.lats.append(lat)
            if prov:
                z = zone(seg, "provincia", prov, f"Provincia di {first.provincia}")
                z.obs.append(ob)
                if lon is not None and lat is not None:
                    z.lons.append(lon)
                    z.lats.append(lat)
            zone(seg, "italia", "IT", "Italia").obs.append(ob)

    for z in zones.values():
        z.sorted_vals = sorted(o.value for o in z.obs)
        z.sorted_asta = sorted(o.value for o in z.asta_obs)
        z.groups = {o.group for o in z.obs} | {o.group for o in z.asta_obs}

    # ---------------------------------------------------------------- benchmark the lots
    lots = db.execute(
        select(
            Lotto,
            Tribunale.pvp_code,
            func.ST_X(cast(Lotto.geom, Geometry)).label("lon"),
            func.ST_Y(cast(Lotto.geom, Geometry)).label("lat"),
        )
        .join(Tribunale, Lotto.tribunale_id == Tribunale.id)
        .where(Lotto.merged_into_id.is_(None), Lotto.status.in_(("active", "unknown")))
    ).all()
    # The first run with data is a silent bootstrap: no event for the opportunities it finds.
    earlier = select(IngestRun.id).where(
        IngestRun.kind == "analytics",
        IngestRun.status == "ok",
        ~func.coalesce(IngestRun.counts.has_key("skipped"), False),  # a run without history doesn't count
    )
    if run is not None and run.id is not None:
        earlier = earlier.where(IngestRun.id != run.id)
    bootstrap = (
        db.scalar(select(Lotto.id).where(Lotto.opportunity_since.is_not(None)).limit(1)) is None
        and db.scalar(earlier.limit(1)) is None
    )
    now = datetime.now(UTC)
    threshold = s.opportunity_threshold_pct

    for lot, trib_code, lon, lat in lots:
        prev_since = lot.opportunity_since
        _clear(lot)
        _derive(lot)
        seg = lot.segment
        surface = lot.superficie_mq
        if not seg or not surface or lot.prezzo_base is None:
            continue
        price_mq = float(lot.prezzo_base) / surface
        if not plausible(seg, surface, price_mq):
            continue
        lot.eur_mq = Decimal(str(round(price_mq, 2)))
        own = _base_group(trib_code, lot.rge_numero, lot.lotto_codice, lot.comune)
        appraisal = max(
            (p for p in (first_round_price.get(own), float(lot.prezzo_primo_esperimento or 0)) if p),
            default=None,
        )
        stima_mq = appraisal / surface if appraisal else None
        if stima_mq:
            lot.eur_mq_stima = Decimal(str(round(stima_mq, 2)))
        prov = norm_text(lot.provincia)
        candidates: list[tuple[str, str]] = []
        if lon is not None and lat is not None and lot.geocode_source != "comune":
            candidates.append(("hex", hex_key(lon, lat, size)))
        if lot.comune:
            candidates.append(("comune", f"{norm_text(lot.comune)}|{prov}"))
        if lon is not None and lat is not None:
            candidates.append(("hexL", hex_key(lon, lat, size_l)))
        if prov:
            candidates.append(("provincia", prov))
        chosen: tuple[Zone, list[float]] | None = None
        italia = zones.get((seg, "italia", "IT"))
        if italia is not None and lot.status == "active":  # national figures only, never a benchmark
            italia.n_active += 1
            insort(italia.active_vals, price_mq)
        for level, key in candidates:
            cz = zones.get((seg, level, key))
            if cz is None:
                continue
            if lot.status == "active":
                cz.n_active += 1
                insort(cz.active_vals, price_mq)
            if chosen is None:
                vals = cz.sorted_vals
                if own in cz.groups:
                    vals = _without(vals, [o.value for o in cz.obs if o.group == own])
                if len(vals) >= MIN_N[level]:
                    chosen = (cz, vals)
        if chosen is None:
            counts["lots_without_zone"] += 1
            continue
        z, vals = chosen
        med, p25, p75 = _stats(vals)
        lot.zona_level, lot.zona_key, lot.zona_label, lot.zona_n = z.level, z.key, _zone_label(z, lot), len(vals)
        lot.zona_eur_mq = Decimal(str(round(med, 2)))
        lot.zona_p25 = Decimal(str(round(p25, 2)))
        lot.zona_p75 = Decimal(str(round(p75, 2)))
        lot.sconto_zona_pct = round((1 - price_mq / med) * 100, 1)
        counts["lots_benchmarked"] += 1
        asta_vals = z.sorted_asta
        if own in z.groups:
            asta_vals = _without(asta_vals, [o.value for o in z.asta_obs if o.group == own])
        if len(asta_vals) >= MIN_N[z.level]:
            asta_med = quantile(asta_vals, 0.5)
            lot.zona_asta_eur_mq = Decimal(str(round(asta_med, 2)))
            lot.sconto_aste_pct = round((1 - price_mq / asta_med) * 100, 1)
        # The lot's own appraisal must look like its zone's: it confirms the surface is right and
        # the property is comparable (a ruin appraised at a third of the zone is cheap for a reason).
        consistent = stima_mq is not None and 0.6 <= stima_mq / med <= 1.6
        is_opp = (
            lot.status == "active"
            and z.level != "provincia"  # a province-wide value is too coarse to call a bargain
            and seg in OPPORTUNITY_SEGMENTS
            and not lot.quota_parziale
            and consistent
            and lot.sconto_zona_pct >= threshold
            and (lot.sconto_aste_pct or -100) >= s.opportunity_auction_pct
        )
        if is_opp:
            z.n_opp += 1
            counts["opportunities"] += 1
            lot.opportunity_since = prev_since or now
            if prev_since is None:
                if not bootstrap:
                    db.add(
                        Evento(
                            lotto_id=lot.id,
                            run_id=run.id if run else None,
                            tipo="opportunity",
                            new={
                                "sconto_zona_pct": lot.sconto_zona_pct,
                                "zona_eur_mq": med,
                                "eur_mq": round(price_mq, 2),
                            },
                        )
                    )
                    counts["event_opportunity"] += 1
        lot.opportunity = is_opp
    db.flush()

    # ---------------------------------------------------------------- persist zones and index
    db.execute(delete(AreaStat))
    year_ago = today - timedelta(days=365)
    two_years_ago = today - timedelta(days=730)
    stats_rows = []
    for z in zones.values():
        if len(z.sorted_vals) < DISPLAY_MIN_N[z.level]:
            continue
        med, p25, p75 = _stats(z.sorted_vals)
        recent = [o.value for o in z.obs if year_ago <= o.day <= today]  # not sales scheduled ahead
        before = [o.value for o in z.obs if two_years_ago <= o.day < year_ago]
        min_trend = 15 if z.level in ("provincia", "italia") else 8
        trend = (
            round((statistics.median(recent) / statistics.median(before) - 1) * 100, 1)
            if len(recent) >= min_trend and len(before) >= min_trend
            else None
        )
        clon: float | None = None
        clat: float | None = None
        poly: list[Any] | None = None
        if z.level in HEX_LEVELS:
            zsize = size if z.level == "hex" else size_l
            clon, clat = hex_center(z.key, zsize)
            poly = hex_polygon(z.key, zsize)
        elif z.lons:
            clon, clat = statistics.fmean(z.lons), statistics.fmean(z.lats)
        stats_rows.append(
            AreaStat(
                segment=z.segment,
                level=z.level,
                key=z.key,
                label=z.label or None,
                n=len(z.sorted_vals),
                median=round(med, 2),
                p25=round(p25, 2),
                p75=round(p75, 2),
                asta_median=round(statistics.median(z.active_vals), 2) if z.active_vals else None,
                n_active=z.n_active,
                n_opportunities=z.n_opp,
                trend_pct=trend,
                center_lon=clon,
                center_lat=clat,
                polygon=poly,
            )
        )
    db.add_all(stats_rows)
    counts["zones"] = len(stats_rows)

    db.execute(delete(PriceIndex))
    # Rolling 12-month median: each quarter pools its own sales with the three before it, so a
    # province with ~25 priced sales a quarter still gives a readable trend.
    index_rows = []
    series: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    for seg, lvl, area, qk in set(stime_by_q) | set(aste_by_q):
        series[(seg, lvl, area)].append(qk)
    this_quarter = _quarter(today)[0]
    for (seg, lvl, area), quarters in series.items():
        observed = [q for q in quarters if q <= this_quarter]
        if not observed:
            continue
        timeline = _quarter_range(min(observed), max(observed))
        for i, qk in enumerate(timeline):
            k = (seg, lvl, area, qk)
            n_st, n_au = len(stime_by_q.get(k, [])), len(aste_by_q.get(k, []))
            if qk in blind_quarters:
                # keep the hole visible instead of drawing a line across it
                index_rows.append(
                    PriceIndex(
                        segment=seg,
                        level=lvl,
                        key=area,
                        quarter=qk,
                        period_start=_quarter_start(qk),
                        n_stime=n_st,
                        stima_eur_mq=None,
                        n_aste=n_au,
                        asta_eur_mq=None,
                        n_deserte=deserte_by_q.get(k, 0),
                        gap=True,
                    )
                )
                continue
            # this quarter and up to three before it, never reaching across a hole
            window = [qk]
            for q in reversed(timeline[max(0, i - 3) : i]):
                if q in blind_quarters:
                    break
                window.append(q)
            st = [v for q in window for v in stime_by_q.get((seg, lvl, area, q), [])]
            au = [v for q in window for v in aste_by_q.get((seg, lvl, area, q), [])]
            # a value needs data of its own quarter, or the median would just repeat older ones
            stima = round(statistics.median(st), 2) if n_st >= INDEX_MIN_OWN and len(st) >= INDEX_MIN_N else None
            asta = round(statistics.median(au), 2) if n_au >= INDEX_MIN_OWN and len(au) >= INDEX_MIN_N else None
            if not n_st and not n_au:
                continue
            index_rows.append(
                PriceIndex(
                    segment=seg,
                    level=lvl,
                    key=area,
                    quarter=qk,
                    period_start=_quarter_start(qk),
                    n_stime=n_st,
                    stima_eur_mq=stima,
                    n_aste=n_au,
                    asta_eur_mq=asta,
                    n_deserte=deserte_by_q.get(k, 0),
                )
            )
    db.add_all(index_rows)
    counts["index_points"] = len(index_rows)
    db.commit()
    counts["bootstrap"] = int(bootstrap)
    log.info("analytics: %s", dict(counts))
    return dict(counts)


def _comune_label(comune: str, provincia: str | None) -> str:
    return f"{comune} ({provincia})" if provincia and norm_text(provincia) != norm_text(comune) else comune


def _zone_label(z: Zone, lot: Lotto) -> str:
    if z.level in HEX_LEVELS:
        return f"Zona di {lot.comune}" if lot.comune else "Zona"
    return z.label


def _derive(lot: Lotto) -> None:
    """Segment, surface and partial ownership for lots synced before these fields existed."""
    if lot.segment is None:
        lot.segment = segment_of(lot.category, lot.subtype)
    if lot.superficie_mq is None and lot.descrizione:
        surface = extract_surface(lot.descrizione, land=lot.segment == "terreni")
        if surface:
            lot.superficie_mq = surface
            lot.superficie_source = "testo"
    elif lot.superficie_mq is not None and lot.superficie_source is None:
        lot.superficie_source = "pvp" if lot.has_detail else "testo"
    if not lot.quota_parziale and is_partial_ownership(lot.descrizione):
        lot.quota_parziale = True


def _clear(lot: Lotto) -> None:
    lot.eur_mq = lot.eur_mq_stima = None
    lot.zona_level = lot.zona_key = lot.zona_label = None
    lot.zona_n = None
    lot.zona_eur_mq = lot.zona_p25 = lot.zona_p75 = None
    lot.sconto_zona_pct = None
    lot.zona_asta_eur_mq = None
    lot.sconto_aste_pct = None
    lot.opportunity = False
    lot.opportunity_since = None


__all__ = ["run_analytics", "SEGMENTS"]
