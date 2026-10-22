"""Staff authentication: argon2 password hashes, JWT in an httpOnly cookie.
Accounts are created from the CLI only (`python -m ingest create-user`); there is no sign-up."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import User

_ph = PasswordHasher()


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, pw)
    except (VerifyMismatchError, InvalidHashError):
        return False


def issue_session(response: Response, user: User) -> None:
    s = get_settings()
    exp = datetime.now(UTC) + timedelta(hours=s.jwt_ttl_hours)
    token = jwt.encode({"sub": str(user.id), "exp": exp}, s.jwt_secret, algorithm="HS256")
    response.set_cookie(
        s.cookie_name,
        token,
        httponly=True,
        secure=s.cookie_secure,
        samesite=s.cookie_samesite,  # type: ignore[arg-type]
        max_age=s.jwt_ttl_hours * 3600,
        path="/",
    )


def clear_session(response: Response) -> None:
    s = get_settings()
    response.delete_cookie(s.cookie_name, path="/", secure=s.cookie_secure, samesite=s.cookie_samesite)  # type: ignore[arg-type]


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    s = get_settings()
    token = request.cookies.get(s.cookie_name)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Non autenticato")
    try:
        payload = jwt.decode(token, s.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessione scaduta") from e
    user = db.get(User, int(payload["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Utente non attivo")
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo amministratori")
    return user
