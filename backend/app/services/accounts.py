"""Staff accounts: one-time links to choose a password (invitations and resets).

The raw token only ever travels in the link; the database keeps its SHA-256. A new link for a
person cancels their previous unused ones, and a link works once."""

from __future__ import annotations

import hashlib
import html
import logging
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.config import get_settings
from app.models import PasswordToken, User
from app.services.email import send_email

log = logging.getLogger("app.accounts")

MIN_PASSWORD = 10
TTL = {"invite": timedelta(days=7), "reset": timedelta(hours=24)}


def _digest(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def new_link(db: Session, user: User, purpose: str, created_by: User | None = None) -> str:
    now = datetime.now(UTC)
    db.execute(
        update(PasswordToken)
        .where(PasswordToken.user_id == user.id, PasswordToken.used_at.is_(None))
        .values(used_at=now)
    )
    raw = secrets.token_urlsafe(32)
    db.add(
        PasswordToken(
            user_id=user.id,
            token_hash=_digest(raw),
            purpose=purpose,
            expires_at=now + TTL[purpose],
            created_by_id=created_by.id if created_by else None,
        )
    )
    db.flush()
    return f"{get_settings().public_app_url.rstrip('/')}/accesso/{raw}"


def invite(
    db: Session, *, email: str, name: str, created_by: User, is_admin: bool = False, cliente_id: int | None = None
) -> tuple[User, str]:
    """A new account without a password, and the link to choose one."""
    email = email.strip().lower()
    if db.scalar(select(User.id).where(func.lower(User.email) == email)):
        raise HTTPException(409, "Esiste già un utente con questa email")
    user = User(email=email, name=name.strip(), password_hash="", is_admin=is_admin, cliente_id=cliente_id)
    db.add(user)
    db.flush()
    link = new_link(db, user, "invite", created_by=created_by)
    db.commit()
    return user, link


def valid_token(db: Session, raw: str) -> PasswordToken | None:
    t = db.scalar(select(PasswordToken).where(PasswordToken.token_hash == _digest(raw)))
    if t is None or t.used_at is not None or t.expires_at <= datetime.now(UTC):
        return None
    return t


def set_password(user: User, password: str) -> None:
    user.password_hash = hash_password(password)
    user.password_changed_at = datetime.now(UTC)


def password_problem(password: str, user: User) -> str | None:
    if len(password) < MIN_PASSWORD:
        return f"La password deve avere almeno {MIN_PASSWORD} caratteri"
    if len(password) > 200:
        return "Password troppo lunga"
    if password.strip().lower() == user.email.lower():
        return "La password non può essere l'indirizzo email"
    return None


def email_link(user: User, link: str, purpose: str) -> bool:
    """Send the link if email is configured. Without RESEND_API_KEY nothing is sent (and the link
    is not written to the log): the admin copies it from the Admin page instead."""
    if not get_settings().resend_api_key:
        return False
    days = TTL[purpose].days or None
    validity = f"{days} giorni" if days else f"{int(TTL[purpose].total_seconds() // 3600)} ore"
    if purpose == "invite" and user.is_client:
        subject = "La tua area riservata Legal Estate"
        intro = (
            "lo studio Legal Estate ti ha aperto un'area riservata dove trovi gli immobili all'asta selezionati "
            "per te e le nostre note. Scegli la tua password da questo link:"
        )
    elif purpose == "invite":
        subject = "Il tuo accesso a Legal Estate · Aste"
        intro = "lo studio ti ha creato un accesso a Legal Estate · Aste. Scegli la tua password da questo link:"
    else:
        subject = "Nuova password per Legal Estate · Aste"
        intro = "hai chiesto di reimpostare la password di Legal Estate · Aste. Scegline una nuova da questo link:"
    text = f"Ciao {user.name},\n{intro}\n\n{link}\n\nIl link vale {validity} e si può usare una volta sola."
    body = (
        "<div style='max-width:560px;margin:auto;padding:24px'>"
        "<div style='font:600 20px Georgia,serif;color:#0b263b'>Legal Estate</div>"
        f"<p style='font:14px/1.6 -apple-system,sans-serif;color:#333'>Ciao {html.escape(user.name)},<br>{intro}</p>"
        f"<p><a href='{html.escape(link)}' style='font:600 14px -apple-system,sans-serif;color:#9a7a12'>"
        "Scegli la password →</a></p>"
        f"<p style='font:12px -apple-system,sans-serif;color:#888'>Il link vale {validity} e si può usare una "
        "volta sola. Se non te lo aspettavi, ignora questa email.</p></div>"
    )
    try:
        send_email(user.email, subject, body, text)
    except Exception:  # noqa: BLE001 - the admin still gets the link on screen
        log.exception("could not email the %s link to user #%s", purpose, user.id)
        return False
    return True


def bootstrap_admin(db: Session) -> bool:
    """Create the first admin from ADMIN_EMAIL / ADMIN_PASSWORD when the users table is empty."""
    s = get_settings()
    if not (s.admin_email and s.admin_password) or db.scalar(select(func.count(User.id))):
        return False
    user = User(
        email=s.admin_email.strip().lower(),
        name=s.admin_name.strip() or "Amministratore",
        password_hash="",
        is_admin=True,
    )
    if problem := password_problem(s.admin_password, user):
        log.warning("ADMIN_PASSWORD not used: %s", problem)
        return False
    set_password(user, s.admin_password)
    db.add(user)
    db.commit()
    log.info("first admin created: %s", user.email)
    return True
