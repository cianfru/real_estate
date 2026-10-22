from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.auth import current_user
from app.db import get_db
from app.models import Cliente, LottoCliente
from app.schemas import ClienteIn, ClienteOut
from app.services.lotti_query import titolo

router = APIRouter(prefix="/clienti", tags=["clienti"], dependencies=[Depends(current_user)])


def _out(c: Cliente) -> ClienteOut:
    return ClienteOut(
        id=c.id,
        display_name=c.display_name,
        notes=c.notes,
        created_at=c.created_at,
        lotti=[
            {
                "link_id": link.id,
                "lotto_id": link.lotto_id,
                "status": link.status,
                "updated_at": link.updated_at,
                "titolo": titolo(link.lotto),
                "comune": link.lotto.comune,
                "tribunale": link.lotto.tribunale.short_name,
                "prezzo_base": float(link.lotto.prezzo_base) if link.lotto.prezzo_base is not None else None,
                "data_vendita": link.lotto.data_vendita,
                "lotto_status": link.lotto.status,
            }
            for link in sorted(c.links, key=lambda x: x.updated_at, reverse=True)
        ],
    )


def _load(db: Session, cid: int) -> Cliente:
    c = db.scalar(
        select(Cliente).where(Cliente.id == cid).options(selectinload(Cliente.links).selectinload(LottoCliente.lotto))
    )
    if c is None:
        raise HTTPException(404, "Cliente non trovato")
    return c


@router.get("", response_model=list[ClienteOut])
def list_clienti(db: Session = Depends(get_db)) -> list[ClienteOut]:
    rows = db.scalars(
        select(Cliente)
        .order_by(Cliente.display_name)
        .options(selectinload(Cliente.links).selectinload(LottoCliente.lotto))
    )
    return [_out(c) for c in rows]


@router.post("", response_model=ClienteOut)
def create_cliente(body: ClienteIn, db: Session = Depends(get_db)) -> ClienteOut:
    c = Cliente(display_name=body.display_name.strip(), notes=body.notes)
    db.add(c)
    db.commit()
    return _out(_load(db, c.id))


@router.get("/{cid}", response_model=ClienteOut)
def get_cliente(cid: int, db: Session = Depends(get_db)) -> ClienteOut:
    return _out(_load(db, cid))


@router.put("/{cid}", response_model=ClienteOut)
def update_cliente(cid: int, body: ClienteIn, db: Session = Depends(get_db)) -> ClienteOut:
    c = _load(db, cid)
    c.display_name, c.notes = body.display_name.strip(), body.notes
    db.commit()
    return _out(c)


@router.delete("/{cid}", status_code=204)
def delete_cliente(cid: int, db: Session = Depends(get_db)) -> None:
    db.delete(_load(db, cid))
    db.commit()
