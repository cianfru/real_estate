from __future__ import annotations

import json
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.auth import current_user
from app.config import get_settings
from app.db import get_db
from app.models import (
    Allegato,
    Cliente,
    ContattoProfessionale,
    Evento,
    Lotto,
    LottoCliente,
    Nota,
    ShareLink,
    User,
    Vendita,
)
from app.schemas import (
    AllegatoOut,
    ClienteLinkOut,
    ContattoOut,
    EventoOut,
    LottiPage,
    LottoClienteIn,
    LottoClienteUpdate,
    LottoDetail,
    LottoFilters,
    NotaIn,
    NotaOut,
    ShareLinkOut,
    SortKey,
    VenditaOut,
)
from app.services import lotti_query as lq

router = APIRouter(prefix="/lotti", tags=["lotti"], dependencies=[Depends(current_user)])


def filters_from_query(
    q: str | None = None,
    tribunale: list[int] = Query(default=[]),
    comune: str | None = None,
    provincia: list[str] = Query(default=[]),
    category: list[str] = Query(default=[]),
    tipologia: list[str] = Query(default=[]),
    price_min: float | None = None,
    price_max: float | None = None,
    surface_min: float | None = None,
    surface_max: float | None = None,
    deadline_from: str | None = None,
    deadline_to: str | None = None,
    occupazione: list[str] = Query(default=[]),
    modalita: list[str] = Query(default=[]),
    status: list[str] = Query(default=["active"]),
    bbox: str | None = None,
    polygon: str | None = Query(default=None, description="GeoJSON geometry, URL-encoded"),
    has_coords: bool | None = None,
    new_days: int | None = None,
    price_dropped: bool | None = None,
    min_rounds: int | None = None,
) -> LottoFilters:
    try:
        poly = json.loads(polygon) if polygon else None
        return LottoFilters(
            q=q,
            tribunale=tribunale,
            comune=comune,
            provincia=provincia,
            category=category,
            tipologia=tipologia,
            price_min=price_min,
            price_max=price_max,
            surface_min=surface_min,
            surface_max=surface_max,
            deadline_from=deadline_from or None,
            deadline_to=deadline_to or None,
            occupazione=occupazione,
            modalita=modalita,
            status=status,
            bbox=bbox,
            polygon=poly,
            has_coords=has_coords,
            new_days=new_days,
            price_dropped=price_dropped,
            min_rounds=min_rounds,
        )
    except (ValueError, json.JSONDecodeError) as e:
        raise HTTPException(422, f"Filtro non valido: {e}") from e


@router.get("", response_model=LottiPage)
def list_lotti(
    f: LottoFilters = Depends(filters_from_query),
    sort: SortKey = "data_vendita",
    page: int = Query(0, ge=0),
    page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
) -> LottiPage:
    items, total = lq.search(db, f, sort, page, page_size)
    return LottiPage(items=items, total=total, page=page, page_size=page_size)


@router.get("/geojson")
def lotti_geojson(f: LottoFilters = Depends(filters_from_query), db: Session = Depends(get_db)) -> dict[str, Any]:
    return lq.geojson(db, f)


# ------------------------------------------------------------------ detail


def _pvp_url(pvp_id: int) -> str:
    return f"{get_settings().pvp_public_url}{pvp_id}"


def _allegato_out(a: Allegato) -> AllegatoOut:
    s = get_settings()
    return AllegatoOut(
        id=a.id,
        tipo=a.tipo,
        descrizione=a.descrizione,
        filename=a.filename,
        url=s.pvp_buckets_host + a.path,
        size=a.size,
    )


def _rounds(lot: Lotto) -> list[VenditaOut]:
    out: list[VenditaOut] = []
    prev = None
    for v in lot.vendite:
        drop = None
        if prev and v.prezzo_base and prev > 0:
            drop = round((1 - float(v.prezzo_base) / float(prev)) * 100, 1)
        out.append(
            VenditaOut(
                id=v.id,
                pvp_id=v.pvp_id,
                round_number=v.round_number,
                data_vendita=v.data_vendita,
                termine_offerte=v.termine_offerte,
                prezzo_base=float(v.prezzo_base) if v.prezzo_base is not None else None,
                offerta_minima=float(v.offerta_minima) if v.offerta_minima is not None else None,
                rialzo_minimo=float(v.rialzo_minimo) if v.rialzo_minimo is not None else None,
                modalita=v.modalita,
                tipo_vendita=v.tipo_vendita,
                esito=v.esito,
                esito_desc=v.esito_desc,
                data_pubblicazione=v.data_pubblicazione,
                drop_pct=drop,
                pvp_url=_pvp_url(v.pvp_id),
                is_current=v.id == lot.current_vendita_id,
                has_detail=v.fetched_at is not None,
            )
        )
        if v.prezzo_base:
            prev = v.prezzo_base
    return out


def current_vendita(lot: Lotto) -> Vendita | None:
    return next((v for v in lot.vendite if v.id == lot.current_vendita_id), lot.vendite[-1] if lot.vendite else None)


def documents(lot: Lotto) -> list[AllegatoOut]:
    """Attachments of the current round, or of the latest round that has any."""
    cur = current_vendita(lot)
    if cur and cur.allegati:
        return [_allegato_out(a) for a in cur.allegati]
    for v in reversed(lot.vendite):
        if v.allegati:
            return [_allegato_out(a) for a in v.allegati]
    return []


def share_url(token: str) -> str:
    return f"{get_settings().public_app_url.rstrip('/')}/s/{token}"


def load_lotto(db: Session, lotto_id: int) -> Lotto:
    lot = db.scalar(
        select(Lotto).where(Lotto.id == lotto_id).options(selectinload(Lotto.vendite).selectinload(Vendita.allegati))
    )
    if lot is None:
        raise HTTPException(404, "Immobile non trovato")
    if lot.merged_into_id:
        return load_lotto(db, lot.merged_into_id)
    return lot


def build_detail(db: Session, lot: Lotto) -> LottoDetail:
    row = db.execute(select(lq.LAT, lq.LON, lq.RIBASSO).select_from(Lotto).where(Lotto.id == lot.id)).one()
    base = lq.to_list_item(lot, row[0], row[1], row[2])
    cur = current_vendita(lot)
    prezzo = float(lot.prezzo_base) if lot.prezzo_base is not None else None
    stima = float(lot.valore_stima) if lot.valore_stima is not None else None
    eventi = db.scalars(
        select(Evento).where(Evento.lotto_id == lot.id, Evento.tipo != "geocoded").order_by(Evento.at.desc()).limit(100)
    ).all()
    note = db.scalars(select(Nota).where(Nota.lotto_id == lot.id).order_by(Nota.created_at.desc())).all()
    links = db.scalars(select(LottoCliente).where(LottoCliente.lotto_id == lot.id)).all()
    shares = db.scalars(
        select(ShareLink).where(ShareLink.lotto_id == lot.id).order_by(ShareLink.created_at.desc())
    ).all()
    contatti: list[ContattoOut] = []
    if get_settings().store_professional_contacts and cur:
        contatti = [
            ContattoOut(role=c.role, name=c.name, email=c.email, phone=c.phone)
            for c in db.scalars(select(ContattoProfessionale).where(ContattoProfessionale.vendita_id == cur.id))
        ]
    return LottoDetail(
        **base.model_dump(),
        rge_numero=lot.rge_numero,
        rge_anno=lot.rge_anno,
        tipo_procedura=lot.tipo_procedura,
        tribunale_name=lot.tribunale.name,
        descrizione=lot.descrizione,
        regione=lot.regione,
        cap=lot.cap,
        vani=lot.vani,
        piano=lot.piano,
        dati_catastali=lot.dati_catastali,
        valore_stima=stima,
        sconto_stima_pct=round((1 - prezzo / stima) * 100, 1) if prezzo and stima else None,
        prezzo_mq=round(prezzo / lot.superficie_mq) if prezzo and lot.superficie_mq else None,
        rialzo_minimo=float(cur.rialzo_minimo) if cur and cur.rialzo_minimo is not None else None,
        tipo_vendita=cur.tipo_vendita if cur else None,
        deposito_cauzionale=cur.deposito_cauzionale if cur else None,
        prezzo_primo_esperimento=float(lot.prezzo_primo_esperimento) if lot.prezzo_primo_esperimento else None,
        geocode_source=lot.geocode_source,
        categorie_bene=lot.categorie_bene,
        pvp_url=_pvp_url(cur.pvp_id) if cur else None,
        siti_pubblicita=(cur.siti_pubblicita or []) if cur else [],
        rounds=_rounds(lot),
        allegati=documents(lot),
        eventi=[
            EventoOut(id=e.id, tipo=e.tipo, vendita_id=e.vendita_id, old=e.old, new=e.new, at=e.at) for e in eventi
        ],
        note=[
            NotaOut(
                id=n.id,
                text=n.text,
                created_at=n.created_at,
                user_id=n.user_id,
                user_name=n.user.name if n.user else None,
            )
            for n in note
        ],
        clienti=[
            ClienteLinkOut(
                id=link.id,
                cliente_id=link.cliente_id,
                cliente_name=link.cliente.display_name,
                status=link.status,
                updated_at=link.updated_at,
            )
            for link in links
        ],
        contatti=contatti,
        share_links=[
            ShareLinkOut(
                id=s.id,
                token=s.token,
                url=share_url(s.token),
                expires_at=s.expires_at,
                revoked=s.revoked,
                created_at=s.created_at,
            )
            for s in shares
        ],
        detail_fetched_at=cur.fetched_at if cur else None,
    )


@router.get("/{lotto_id}", response_model=LottoDetail)
def get_lotto(lotto_id: int, db: Session = Depends(get_db)) -> LottoDetail:
    return build_detail(db, load_lotto(db, lotto_id))


@router.post("/{lotto_id}/refresh", response_model=LottoDetail)
def refresh_lotto(lotto_id: int, db: Session = Depends(get_db)) -> LottoDetail:
    """On-demand detail fetch from PVP (one request per round, rate-limited client)."""
    from ingest.pvp_client import PvpClient, PvpError
    from ingest.sync import Syncer

    lot = load_lotto(db, lotto_id)
    cur = current_vendita(lot)
    if cur is None:
        raise HTTPException(404, "Nessun esperimento di vendita")
    client = PvpClient()
    try:
        Syncer(db, client).fetch_and_apply_detail(cur)
        db.commit()
    except PvpError as e:
        db.rollback()
        raise HTTPException(502, f"PVP non raggiungibile: {e}") from e
    finally:
        client.close()
    db.expire_all()
    return build_detail(db, load_lotto(db, lotto_id))


# ------------------------------------------------------------------ notes


@router.post("/{lotto_id}/note", response_model=NotaOut)
def add_note(lotto_id: int, body: NotaIn, db: Session = Depends(get_db), user: User = Depends(current_user)) -> NotaOut:
    lot = load_lotto(db, lotto_id)
    n = Nota(lotto_id=lot.id, user_id=user.id, text=body.text.strip())
    db.add(n)
    db.commit()
    return NotaOut(id=n.id, text=n.text, created_at=n.created_at, user_id=user.id, user_name=user.name)


@router.delete("/{lotto_id}/note/{nota_id}", status_code=204)
def delete_note(lotto_id: int, nota_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> None:
    n = db.get(Nota, nota_id)
    if n is None or n.lotto_id != lotto_id:
        raise HTTPException(404, "Nota non trovata")
    if n.user_id != user.id and not user.is_admin:
        raise HTTPException(403, "Puoi eliminare solo le tue note")
    db.delete(n)
    db.commit()


# ------------------------------------------------------------------ clients


@router.post("/{lotto_id}/clienti", response_model=ClienteLinkOut)
def link_cliente(lotto_id: int, body: LottoClienteIn, db: Session = Depends(get_db)) -> ClienteLinkOut:
    lot = load_lotto(db, lotto_id)
    cliente = db.get(Cliente, body.cliente_id)
    if cliente is None:
        raise HTTPException(404, "Cliente non trovato")
    link = db.scalar(select(LottoCliente).where(LottoCliente.lotto_id == lot.id, LottoCliente.cliente_id == cliente.id))
    if link is None:
        link = LottoCliente(lotto_id=lot.id, cliente_id=cliente.id, status=body.status)
        db.add(link)
    else:
        link.status = body.status
    db.commit()
    db.refresh(link)
    return ClienteLinkOut(
        id=link.id,
        cliente_id=cliente.id,
        cliente_name=cliente.display_name,
        status=link.status,
        updated_at=link.updated_at,
    )


@router.patch("/{lotto_id}/clienti/{link_id}", response_model=ClienteLinkOut)
def update_link(lotto_id: int, link_id: int, body: LottoClienteUpdate, db: Session = Depends(get_db)) -> ClienteLinkOut:
    link = db.get(LottoCliente, link_id)
    if link is None or link.lotto_id != lotto_id:
        raise HTTPException(404, "Collegamento non trovato")
    link.status = body.status
    db.commit()
    db.refresh(link)
    return ClienteLinkOut(
        id=link.id,
        cliente_id=link.cliente_id,
        cliente_name=link.cliente.display_name,
        status=link.status,
        updated_at=link.updated_at,
    )


@router.delete("/{lotto_id}/clienti/{link_id}", status_code=204)
def unlink_cliente(lotto_id: int, link_id: int, db: Session = Depends(get_db)) -> None:
    link = db.get(LottoCliente, link_id)
    if link is None or link.lotto_id != lotto_id:
        raise HTTPException(404, "Collegamento non trovato")
    db.delete(link)
    db.commit()


# ------------------------------------------------------------------ share links


@router.post("/{lotto_id}/share", response_model=ShareLinkOut)
def create_share(
    lotto_id: int,
    days: int | None = Query(None, ge=1, le=365),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> ShareLinkOut:
    lot = load_lotto(db, lotto_id)
    ttl = days or get_settings().share_link_days
    s = ShareLink(
        token=secrets.token_urlsafe(24),
        lotto_id=lot.id,
        created_by=user.id,
        expires_at=datetime.now(UTC) + timedelta(days=ttl),
    )
    db.add(s)
    db.commit()
    return ShareLinkOut(
        id=s.id,
        token=s.token,
        url=share_url(s.token),
        expires_at=s.expires_at,
        revoked=s.revoked,
        created_at=s.created_at,
    )


@router.post("/{lotto_id}/share/{share_id}/revoke", response_model=ShareLinkOut)
def revoke_share(lotto_id: int, share_id: int, db: Session = Depends(get_db)) -> ShareLinkOut:
    s = db.get(ShareLink, share_id)
    if s is None or s.lotto_id != lotto_id:
        raise HTTPException(404, "Link non trovato")
    s.revoked = True
    db.commit()
    return ShareLinkOut(
        id=s.id,
        token=s.token,
        url=share_url(s.token),
        expires_at=s.expires_at,
        revoked=s.revoked,
        created_at=s.created_at,
    )
