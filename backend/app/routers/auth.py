from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import clear_session, issue_session, session_user, verify_password
from app.db import get_db
from app.models import PasswordToken, User
from app.schemas import ChangeEmailIn, ChangePasswordIn, ForgotPasswordIn, LoginIn, SetPasswordIn, TokenInfoOut, UserOut
from app.services.accounts import email_link, new_link, password_problem, set_email, set_password, valid_token

router = APIRouter(prefix="/auth", tags=["auth"])

FORGOT_COOLDOWN = timedelta(minutes=5)


def _out(u: User) -> UserOut:
    return UserOut(
        id=u.id,
        email=u.email,
        name=u.name,
        is_admin=u.is_admin and not u.is_client,
        role="client" if u.is_client else "staff",
        cliente_name=u.cliente.display_name if u.cliente else None,
    )


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)) -> UserOut:
    user = db.scalar(select(User).where(func.lower(User.email) == body.email.strip().lower()))
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Email o password non corretti")
    user.last_login_at = datetime.now(UTC)
    db.commit()
    issue_session(response, user)
    return _out(user)


@router.post("/logout", status_code=204)
def logout(response: Response) -> None:
    clear_session(response)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(session_user)) -> UserOut:
    return _out(user)


@router.post("/password", response_model=UserOut)
def change_password(
    body: ChangePasswordIn, response: Response, db: Session = Depends(get_db), user: User = Depends(session_user)
) -> UserOut:
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "La password attuale non è corretta")
    if problem := password_problem(body.new_password, user):
        raise HTTPException(422, problem)
    set_password(user, body.new_password)
    db.commit()
    issue_session(response, user)  # this browser stays logged in, every other session is closed
    return _out(user)


@router.post("/email", response_model=UserOut)
def change_email(body: ChangeEmailIn, db: Session = Depends(get_db), user: User = Depends(session_user)) -> UserOut:
    """Your own login email; the password confirms it's really you at the keyboard."""
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "La password non è corretta")
    set_email(db, user, str(body.email))
    db.commit()
    return _out(user)


# ------------------------------------------------------------ one-time links (no session needed)


def _token(db: Session, token: str) -> PasswordToken:
    t = valid_token(db, token)
    if t is None:
        raise HTTPException(410, "Il link non è più valido: chiedine uno nuovo all'amministratore dello studio")
    return t


@router.get("/token/{token}", response_model=TokenInfoOut)
def token_info(token: str, db: Session = Depends(get_db)) -> TokenInfoOut:
    t = _token(db, token)
    user = db.get(User, t.user_id)
    if user is None or not user.is_active:
        raise HTTPException(410, "Account non attivo")
    return TokenInfoOut(email=user.email, name=user.name, purpose=t.purpose)  # type: ignore[arg-type]


@router.post("/token/{token}", response_model=UserOut)
def use_token(token: str, body: SetPasswordIn, response: Response, db: Session = Depends(get_db)) -> UserOut:
    t = _token(db, token)
    user = db.get(User, t.user_id)
    if user is None or not user.is_active:
        raise HTTPException(410, "Account non attivo")
    if problem := password_problem(body.password, user):
        raise HTTPException(422, problem)
    set_password(user, body.password)
    now = datetime.now(UTC)
    t.used_at = now
    user.last_login_at = now
    db.commit()
    issue_session(response, user)
    return _out(user)


@router.post("/forgot", status_code=202)
def forgot_password(body: ForgotPasswordIn, db: Session = Depends(get_db)) -> dict[str, str]:
    """Same answer whether or not the address exists, so the form can't be used to probe emails."""
    user = db.scalar(select(User).where(func.lower(User.email) == body.email.strip().lower()))
    if user is not None and user.is_active:
        recent = db.scalar(
            select(PasswordToken.id).where(
                PasswordToken.user_id == user.id, PasswordToken.created_at > datetime.now(UTC) - FORGOT_COOLDOWN
            )
        )
        if recent is None:
            purpose = "invite" if user.pending_invite else "reset"
            link = new_link(db, user, purpose)
            if email_link(user, link, purpose):
                db.commit()
            else:
                db.rollback()  # email not configured: no link nobody will receive
    return {"status": "ok"}
