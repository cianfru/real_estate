"""Builds the SQL for lot searches. Used by the list, the map layer and saved-search alerts."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from geoalchemy2 import Geometry
from sqlalchemy import ColumnElement, Select, and_, case, cast, func, or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.labels import tipologia_label
from app.models import Lotto, Tribunale
from app.schemas import LottoFilters, LottoListItem, SortKey, TribunaleBrief

GEOM = cast(Lotto.geom, Geometry)
LAT = func.ST_Y(GEOM)
LON = func.ST_X(GEOM)
RIBASSO = case(
    (
        and_(Lotto.prezzo_primo_esperimento > 0, Lotto.prezzo_base.is_not(None)),
        (1 - Lotto.prezzo_base / Lotto.prezzo_primo_esperimento) * 100,
    ),
    else_=None,
)
DEADLINE = func.coalesce(Lotto.termine_offerte, Lotto.data_vendita)


def apply_filters(q: Select[Any], f: LottoFilters) -> Select[Any]:
    conds: list[ColumnElement[bool]] = [Lotto.merged_into_id.is_(None)]
    if f.status:
        conds.append(Lotto.status.in_(f.status))
    if f.tribunale:
        conds.append(Lotto.tribunale_id.in_(f.tribunale))
    if f.comune:
        conds.append(Lotto.comune.ilike(f"%{f.comune.strip()}%"))
    if f.provincia:
        conds.append(or_(Lotto.provincia.in_(f.provincia), Lotto.provincia_sigla.in_(f.provincia)))
    if f.category:
        conds.append(Lotto.category.in_(f.category))
    if f.tipologia:
        conds.append(Lotto.categorie_bene.overlap(f.tipologia))
    if f.price_min is not None:
        conds.append(Lotto.prezzo_base >= f.price_min)
    if f.price_max is not None:
        conds.append(Lotto.prezzo_base <= f.price_max)
    if f.surface_min is not None:
        conds.append(Lotto.superficie_mq >= f.surface_min)
    if f.surface_max is not None:
        conds.append(Lotto.superficie_mq <= f.surface_max)
    if f.deadline_from:
        conds.append(DEADLINE >= f.deadline_from)
    if f.deadline_to:
        conds.append(DEADLINE < f.deadline_to + timedelta(days=1))
    if f.occupazione:
        conds.append(Lotto.occupazione.in_(f.occupazione))
    if f.modalita:
        conds.append(Lotto.modalita.in_(f.modalita))
    if f.has_coords is True:
        conds.append(Lotto.geom.is_not(None))
    elif f.has_coords is False:
        conds.append(Lotto.geom.is_(None))
    if f.new_days:
        conds.append(Lotto.first_seen >= datetime.now(UTC) - timedelta(days=f.new_days))
    if f.price_dropped:
        conds.append(Lotto.prezzo_base < Lotto.prezzo_primo_esperimento)
    if f.min_rounds:
        conds.append(Lotto.n_rounds >= f.min_rounds)
    if f.bbox:
        w, s, e, n = (float(x) for x in f.bbox.split(","))
        conds.append(func.ST_Intersects(GEOM, func.ST_MakeEnvelope(w, s, e, n, 4326)))
    if f.polygon:
        conds.append(func.ST_Intersects(GEOM, func.ST_SetSRID(func.ST_GeomFromGeoJSON(json.dumps(f.polygon)), 4326)))
    if f.q:
        like = f"%{f.q.strip()}%"
        conds.append(
            or_(
                Lotto.descrizione.ilike(like),
                Lotto.indirizzo.ilike(like),
                Lotto.comune.ilike(like),
                Lotto.rge_numero == f.q.strip().split("/")[0],
            )
        )
    return q.where(*conds)


def apply_sort(q: Select[Any], sort: SortKey) -> Select[Any]:
    orders: dict[str, list[Any]] = {
        "data_vendita": [Lotto.data_vendita.asc().nulls_last()],
        "termine": [DEADLINE.asc().nulls_last()],
        "prezzo_asc": [Lotto.prezzo_base.asc().nulls_last()],
        "prezzo_desc": [Lotto.prezzo_base.desc().nulls_last()],
        "ribasso": [RIBASSO.desc().nulls_last()],
        "nuovi": [Lotto.first_seen.desc()],
        "superficie": [Lotto.superficie_mq.desc().nulls_last()],
    }
    return q.order_by(*orders[sort], Lotto.id)


def base_select() -> Select[Any]:
    return select(Lotto, LAT.label("lat"), LON.label("lon"), RIBASSO.label("ribasso")).join(
        Tribunale, Lotto.tribunale_id == Tribunale.id
    )


def cover_url(lot: Lotto) -> str | None:
    if not lot.cover_image_path:
        return None
    p = lot.cover_image_path
    if p.startswith("http"):
        return p
    return get_settings().pvp_buckets_host + (p if p.startswith("/") else "/" + p)


def titolo(lot: Lotto) -> str:
    tip = tipologia_label(lot.subtype) or "Immobile"
    return f"{tip} a {lot.comune}" if lot.comune else tip


def is_approx(lot: Lotto) -> bool:
    return lot.geom is not None and (lot.geocode_source == "comune" or (lot.geocode_confidence or 0) < 0.5)


def to_list_item(lot: Lotto, lat: float | None, lon: float | None, ribasso: Any) -> LottoListItem:
    return LottoListItem(
        id=lot.id,
        tribunale=TribunaleBrief(id=lot.tribunale.id, short_name=lot.tribunale.short_name),
        rge=f"{lot.rge_numero}/{lot.rge_anno}" if lot.rge_anno else lot.rge_numero,
        lotto_codice=lot.lotto_codice,
        category=lot.category,
        tipologia=lot.subtype,
        titolo=titolo(lot),
        indirizzo=lot.indirizzo,
        comune=lot.comune,
        provincia=lot.provincia,
        lat=lat,
        lon=lon,
        approx=is_approx(lot),
        prezzo_base=float(lot.prezzo_base) if lot.prezzo_base is not None else None,
        offerta_minima=float(lot.offerta_minima) if lot.offerta_minima is not None else None,
        data_vendita=lot.data_vendita,
        termine_offerte=lot.termine_offerte,
        modalita=lot.modalita,
        occupazione=lot.occupazione,
        superficie_mq=lot.superficie_mq,
        n_rounds=lot.n_rounds,
        ribasso_pct=round(float(ribasso), 1) if ribasso is not None and float(ribasso) > 0.05 else None,
        status=lot.status,
        first_seen=lot.first_seen,
        cover_url=cover_url(lot),
        has_detail=lot.has_detail,
    )


def search(db: Session, f: LottoFilters, sort: SortKey, page: int, page_size: int) -> tuple[list[LottoListItem], int]:
    q = apply_filters(base_select(), f)
    total = db.scalar(apply_filters(select(func.count(Lotto.id)), f)) or 0
    rows = db.execute(apply_sort(q, sort).offset(page * page_size).limit(page_size)).all()
    return [to_list_item(r[0], r[1], r[2], r[3]) for r in rows], total


def geojson(db: Session, f: LottoFilters, limit: int = 20000) -> dict[str, Any]:
    q = apply_filters(
        select(
            Lotto.id,
            LAT,
            LON,
            Lotto.category,
            Lotto.prezzo_base,
            Lotto.geocode_source,
            Lotto.geocode_confidence,
            Lotto.status,
            Lotto.subtype,
            Lotto.comune,
            Lotto.data_vendita,
        ).where(Lotto.geom.is_not(None)),
        f,
    ).limit(limit)
    features = []
    for r in db.execute(q):
        approx = r.geocode_source == "comune" or (r.geocode_confidence or 0) < 0.5
        features.append(
            {
                "type": "Feature",
                "id": r.id,
                "geometry": {"type": "Point", "coordinates": [round(r[2], 6), round(r[1], 6)]},
                "properties": {
                    "id": r.id,
                    "c": r.category or "ALTRA_CATEGORIA",
                    "p": float(r.prezzo_base) if r.prezzo_base is not None else None,
                    "a": 1 if approx else 0,
                    "t": tipologia_label(r.subtype),
                    "m": r.comune,
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}
