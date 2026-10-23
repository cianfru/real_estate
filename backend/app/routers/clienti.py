from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.auth import current_user
from app.db import get_db
from app.models import Cliente, LottoCliente, User
from app.schemas import AdminUserOut, ClientAccountIn, ClientAccountPatch, ClienteIn, ClienteOut, PasswordLinkOut
from app.services.accounts import email_link, invite, new_link
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
                "nel_portale": link.nel_portale,
                "nota_cliente": link.nota_cliente,
            }
            for link in sorted(c.links, key=lambda x: x.updated_at, reverse=True)
        ],
        accounts=[AdminUserOut.model_validate(u) for u in c.accounts],
    )


def _load(db: Session, cid: int) -> Cliente:
    c = db.scalar(
        select(Cliente)
        .where(Cliente.id == cid)
        .options(selectinload(Cliente.links).selectinload(LottoCliente.lotto), selectinload(Cliente.accounts))
    )
    if c is None:
        raise HTTPException(404, "Cliente non trovato")
    return c


@router.get("", response_model=list[ClienteOut])
def list_clienti(db: Session = Depends(get_db)) -> list[ClienteOut]:
    rows = db.scalars(
        select(Cliente)
        .order_by(Cliente.display_name)
        .options(selectinload(Cliente.links).selectinload(LottoCliente.lotto), selectinload(Cliente.accounts))
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


# ------------------------------------------------------------ logins to the client area
# Any staff member can give their client access: the client only ever sees the properties
# linked to them and marked visible (app.routers.portale).


def _account(db: Session, cid: int, uid: int) -> User:
    user = db.get(User, uid)
    if user is None or user.cliente_id != cid:
        raise HTTPException(404, "Accesso non trovato")
    return user


@router.post("/{cid}/accounts", response_model=PasswordLinkOut, status_code=201)
def invite_client(
    cid: int, body: ClientAccountIn, db: Session = Depends(get_db), staff: User = Depends(current_user)
) -> PasswordLinkOut:
    c = _load(db, cid)
    user, link = invite(db, email=str(body.email), name=body.name, created_by=staff, cliente_id=c.id)
    return PasswordLinkOut(
        user=AdminUserOut.model_validate(user), link=link, purpose="invite", emailed=email_link(user, link, "invite")
    )


@router.post("/{cid}/accounts/{uid}/link", response_model=PasswordLinkOut)
def client_link(
    cid: int, uid: int, db: Session = Depends(get_db), staff: User = Depends(current_user)
) -> PasswordLinkOut:
    user = _account(db, cid, uid)
    if not user.is_active:
        raise HTTPException(409, "Riattiva l'accesso prima di mandare un link")
    purpose = "invite" if user.pending_invite else "reset"
    link = new_link(db, user, purpose, created_by=staff)
    db.commit()
    return PasswordLinkOut(
        user=AdminUserOut.model_validate(user), link=link, purpose=purpose, emailed=email_link(user, link, purpose)
    )


@router.patch("/{cid}/accounts/{uid}", response_model=AdminUserOut)
def set_client_account(cid: int, uid: int, body: ClientAccountPatch, db: Session = Depends(get_db)) -> User:
    user = _account(db, cid, uid)
    user.is_active = body.is_active
    db.commit()
    return user


@router.delete("/{cid}/accounts/{uid}", status_code=204)
def delete_client_account(cid: int, uid: int, db: Session = Depends(get_db)) -> None:
    """Erases the login (name, email, password) for good; the client's file stays."""
    db.delete(_account(db, cid, uid))
    db.commit()
