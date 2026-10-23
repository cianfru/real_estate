"""The client area: a client sees the properties the firm linked to them (and didn't hide), with
the same facts as a share link plus where the firm stands and its message. Nothing else of the
firm's app is reachable with a client login (app.auth.current_user refuses it)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import Select, select
from sqlalchemy.orm import Session, selectinload

from app.auth import client_user
from app.db import get_db
from app.models import Lotto, LottoCliente, User
from app.routers.lotti import load_lotto
from app.routers.public import public_view
from app.schemas import PortalItem, PortalLotto
from app.services.lotti_query import cover_url, titolo

router = APIRouter(prefix="/portale", tags=["portale"])


def _visible(user: User) -> Select[LottoCliente]:
    return select(LottoCliente).where(LottoCliente.cliente_id == user.cliente_id, LottoCliente.nel_portale.is_(True))


@router.get("/immobili", response_model=list[PortalItem])
def immobili(db: Session = Depends(get_db), user: User = Depends(client_user)) -> list[PortalItem]:
    links = db.scalars(
        _visible(user)
        .options(selectinload(LottoCliente.lotto).selectinload(Lotto.tribunale))
        .order_by(LottoCliente.updated_at.desc())
    )
    return [
        PortalItem(
            lotto_id=link.lotto_id,
            titolo=titolo(link.lotto),
            comune=link.lotto.comune,
            provincia=link.lotto.provincia,
            tribunale=link.lotto.tribunale.short_name,
            prezzo_base=float(link.lotto.prezzo_base) if link.lotto.prezzo_base is not None else None,
            superficie_mq=link.lotto.superficie_mq,
            data_vendita=link.lotto.data_vendita,
            termine_offerte=link.lotto.termine_offerte,
            lotto_status=link.lotto.status,
            cover_url=cover_url(link.lotto),
            stato=link.status,
            nota_cliente=link.nota_cliente,
            aggiornato=link.updated_at,
        )
        for link in links
    ]


@router.get("/immobili/{lotto_id}", response_model=PortalLotto)
def immobile(lotto_id: int, db: Session = Depends(get_db), user: User = Depends(client_user)) -> PortalLotto:
    link = db.scalar(_visible(user).where(LottoCliente.lotto_id == lotto_id))
    if link is None:
        raise HTTPException(404, "Immobile non trovato")
    base = public_view(db, load_lotto(db, lotto_id), expires_at=None)
    return PortalLotto(
        **base.model_dump(), stato=link.status, nota_cliente=link.nota_cliente, aggiornato=link.updated_at
    )
