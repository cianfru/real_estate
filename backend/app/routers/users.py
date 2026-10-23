"""Staff accounts from the Admin page: invite, resend a password link, rename, make admin,
deactivate. Nobody ever sees or sets another person's password."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import admin_user
from app.db import get_db
from app.models import User
from app.schemas import AdminUserOut, PasswordLinkOut, UserCreateIn, UserPatchIn
from app.services.accounts import email_link, invite, new_link, set_email

router = APIRouter(prefix="/admin/users", tags=["admin"])


def _get(db: Session, uid: int) -> User:
    user = db.get(User, uid)
    if user is None or user.is_client:  # client logins are managed from their client's page
        raise HTTPException(404, "Utente non trovato")
    return user


@router.get("", response_model=list[AdminUserOut])
def list_users(db: Session = Depends(get_db), _: User = Depends(admin_user)) -> list[User]:
    staff = select(User).where(User.cliente_id.is_(None))
    return list(db.scalars(staff.order_by(User.is_active.desc(), func.lower(User.name))))


@router.post("", response_model=PasswordLinkOut, status_code=201)
def invite_staff(
    body: UserCreateIn, db: Session = Depends(get_db), admin: User = Depends(admin_user)
) -> PasswordLinkOut:
    user, link = invite(db, email=str(body.email), name=body.name, created_by=admin, is_admin=body.is_admin)
    return PasswordLinkOut(
        user=AdminUserOut.model_validate(user), link=link, purpose="invite", emailed=email_link(user, link, "invite")
    )


@router.post("/{uid}/link", response_model=PasswordLinkOut)
def password_link(uid: int, db: Session = Depends(get_db), admin: User = Depends(admin_user)) -> PasswordLinkOut:
    """A fresh invitation (not yet accepted) or password reset link; earlier links stop working."""
    user = _get(db, uid)
    if not user.is_active:
        raise HTTPException(409, "Riattiva l'utente prima di mandargli un link")
    purpose = "invite" if user.pending_invite else "reset"
    link = new_link(db, user, purpose, created_by=admin)
    db.commit()
    return PasswordLinkOut(
        user=AdminUserOut.model_validate(user), link=link, purpose=purpose, emailed=email_link(user, link, purpose)
    )


@router.patch("/{uid}", response_model=AdminUserOut)
def edit(uid: int, body: UserPatchIn, db: Session = Depends(get_db), admin: User = Depends(admin_user)) -> User:
    user = _get(db, uid)
    if user.id == admin.id and (body.is_active is False or body.is_admin is False):
        # also guarantees there is always at least one active admin
        raise HTTPException(409, "Non puoi disattivare il tuo account o togliergli i permessi di amministratore")
    if body.name is not None:
        user.name = body.name.strip()
    if body.email is not None:
        set_email(db, user, str(body.email))
    if body.is_admin is not None:
        user.is_admin = body.is_admin
    if body.is_active is not None:
        user.is_active = body.is_active  # a deactivated user's open sessions stop working at once
    db.commit()
    return user
