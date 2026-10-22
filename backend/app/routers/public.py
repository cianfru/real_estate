from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ShareLink
from app.ratelimit import public_rate_limit
from app.routers.lotti import _rounds, build_detail, current_vendita, documents, load_lotto
from app.schemas import PublicLotto

router = APIRouter(prefix="/public", tags=["public"], dependencies=[Depends(public_rate_limit)])


@router.get("/lotti/{token}", response_model=PublicLotto)
def public_lotto(token: str, db: Session = Depends(get_db)) -> PublicLotto:
    s = db.scalar(select(ShareLink).where(ShareLink.token == token))
    if s is None or s.revoked or (s.expires_at and s.expires_at < datetime.now(UTC)):
        raise HTTPException(404, "Link non valido o scaduto")
    lot = load_lotto(db, s.lotto_id)
    d = build_detail(db, lot)
    cur = current_vendita(lot)
    # Whitelist: only property facts. Notes, clients, events and contacts never leave the firm.
    return PublicLotto(
        titolo=d.titolo,
        tribunale=d.tribunale_name,
        rge=d.rge,
        lotto_codice=d.lotto_codice,
        tipologia=d.tipologia,
        category=d.category,
        indirizzo=d.indirizzo,
        comune=d.comune,
        provincia=d.provincia,
        lat=d.lat,
        lon=d.lon,
        approx=d.approx,
        descrizione=d.descrizione,
        superficie_mq=d.superficie_mq,
        vani=d.vani,
        piano=d.piano,
        occupazione=d.occupazione,
        prezzo_base=d.prezzo_base,
        offerta_minima=d.offerta_minima,
        rialzo_minimo=d.rialzo_minimo,
        valore_stima=d.valore_stima,
        sconto_stima_pct=d.sconto_stima_pct,
        ribasso_pct=d.ribasso_pct,
        prezzo_primo_esperimento=d.prezzo_primo_esperimento,
        prezzo_mq=d.prezzo_mq,
        data_vendita=d.data_vendita,
        termine_offerte=d.termine_offerte,
        modalita=d.modalita,
        deposito_cauzionale=d.deposito_cauzionale,
        status=d.status,
        cover_url=d.cover_url,
        rounds=_rounds(lot),
        allegati=documents(lot),
        pvp_url=d.pvp_url if cur else None,
        expires_at=s.expires_at,
        eur_mq=d.eur_mq,
        eur_mq_stima=d.eur_mq_stima,
        sconto_zona_pct=d.sconto_zona_pct,
        zona=d.zona,
    )
