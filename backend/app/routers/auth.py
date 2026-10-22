from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import clear_session, current_user, issue_session, verify_password
from app.db import get_db
from app.models import User
from app.schemas import LoginIn, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


def _out(u: User) -> UserOut:
    return UserOut(id=u.id, email=u.email, name=u.name, is_admin=u.is_admin)


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)) -> UserOut:
    user = db.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Email o password non corretti")
    issue_session(response, user)
    return _out(user)


@router.post("/logout", status_code=204)
def logout(response: Response) -> None:
    clear_session(response)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)) -> UserOut:
    return _out(user)
