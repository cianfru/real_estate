import re
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth import hash_password
from app.main import app
from app.models import IngestRun, PasswordToken, User

H = {"X-Requested-With": "fetch"}


def _login(email: str, password: str) -> TestClient:
    c = TestClient(app)
    r = c.post("/auth/login", json={"email": email, "password": password}, headers=H)
    assert r.status_code == 200, r.text
    return c


@pytest.fixture
def admin(db: Any) -> TestClient:
    db.add(User(email="avv@example.org", name="Avvocata", password_hash=hash_password("password-lunga"), is_admin=True))
    db.commit()
    return _login("avv@example.org", "password-lunga")


def _token(link: str) -> str:
    m = re.search(r"/accesso/([\w-]+)$", link)
    assert m, link
    return m.group(1)


def test_invite_choose_password_and_log_in(admin: TestClient, db: Any) -> None:
    r = admin.post("/admin/users", json={"email": "Collab@Example.org", "name": "Collaboratore"}, headers=H)
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["user"]["pending_invite"] and out["purpose"] == "invite" and not out["emailed"]
    token = _token(out["link"])
    assert db.scalar(select(PasswordToken.token_hash)) != token  # only the hash is stored

    anon = TestClient(app)
    assert anon.get(f"/auth/token/{token}").json() == {
        "email": "collab@example.org",
        "name": "Collaboratore",
        "purpose": "invite",
    }
    assert anon.post(f"/auth/token/{token}", json={"password": "corta"}, headers=H).status_code == 422
    r = anon.post(f"/auth/token/{token}", json={"password": "una-password-lunga"}, headers=H)
    assert r.status_code == 200 and anon.get("/auth/me").json()["email"] == "collab@example.org"
    assert anon.get(f"/auth/token/{token}").status_code == 410  # one use only
    _login("collab@example.org", "una-password-lunga")
    assert admin.post("/admin/users", json={"email": "collab@example.org", "name": "X"}, headers=H).status_code == 409


def test_only_admins_manage_users(admin: TestClient, db: Any) -> None:
    db.add(User(email="staff@example.org", name="Staff", password_hash=hash_password("password-lunga")))
    db.commit()
    staff = _login("staff@example.org", "password-lunga")
    assert staff.get("/admin/users").status_code == 403
    assert staff.post("/admin/users", json={"email": "x@example.org", "name": "X"}, headers=H).status_code == 403
    assert staff.post("/admin/history", headers=H).status_code == 403
    assert len(admin.get("/admin/users").json()) == 2


def test_deactivate_reset_and_guards(admin: TestClient, db: Any) -> None:
    db.add(User(email="staff@example.org", name="Staff", password_hash=hash_password("password-lunga")))
    db.commit()
    staff = _login("staff@example.org", "password-lunga")
    sid = db.scalar(select(User.id).where(User.email == "staff@example.org"))
    me = admin.get("/auth/me").json()["id"]

    assert admin.patch(f"/admin/users/{me}", json={"is_active": False}, headers=H).status_code == 409
    assert admin.patch(f"/admin/users/{me}", json={"is_admin": False}, headers=H).status_code == 409

    # reset link: the old one dies when a new one is made, the old password stops working once used
    first = _token(admin.post(f"/admin/users/{sid}/link", headers=H).json()["link"])
    out = admin.post(f"/admin/users/{sid}/link", headers=H).json()
    assert out["purpose"] == "reset"
    assert TestClient(app).get(f"/auth/token/{first}").status_code == 410
    assert (
        TestClient(app)
        .post(f"/auth/token/{_token(out['link'])}", json={"password": "nuova-password-1"}, headers=H)
        .status_code
        == 200
    )
    assert staff.get("/auth/me").status_code == 401  # sessions opened before the reset are closed
    staff = _login("staff@example.org", "nuova-password-1")

    assert admin.patch(f"/admin/users/{sid}", json={"is_active": False}, headers=H).json()["is_active"] is False
    assert staff.get("/auth/me").status_code == 401
    assert (
        TestClient(app)
        .post("/auth/login", json={"email": "staff@example.org", "password": "nuova-password-1"}, headers=H)
        .status_code
        == 401
    )
    assert admin.post(f"/admin/users/{sid}/link", headers=H).status_code == 409


def test_change_own_password_closes_other_sessions(admin: TestClient) -> None:
    other = _login("avv@example.org", "password-lunga")
    bad = {"current_password": "sbagliata", "new_password": "nuova-password-1"}
    assert admin.post("/auth/password", json=bad, headers=H).status_code == 400
    ok = {"current_password": "password-lunga", "new_password": "nuova-password-1"}
    assert admin.post("/auth/password", json=ok, headers=H).status_code == 200
    assert admin.get("/auth/me").status_code == 200  # this browser got a fresh session
    assert other.get("/auth/me").status_code == 401


def test_forgot_password_never_reveals_who_exists(admin: TestClient, db: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    import app.services.accounts as accounts

    anon = TestClient(app)
    # without email configured nothing is created (and nothing is logged)
    assert anon.post("/auth/forgot", json={"email": "avv@example.org"}, headers=H).json() == {"status": "ok"}
    assert db.scalar(select(PasswordToken.id)) is None

    sent: list[str] = []
    monkeypatch.setattr(accounts.get_settings(), "resend_api_key", "test-key")
    monkeypatch.setattr(accounts, "send_email", lambda to, subject, html, text: sent.append(text))
    assert anon.post("/auth/forgot", json={"email": "nessuno@example.org"}, headers=H).json() == {"status": "ok"}
    assert anon.post("/auth/forgot", json={"email": "AVV@example.org"}, headers=H).json() == {"status": "ok"}
    assert anon.post("/auth/forgot", json={"email": "avv@example.org"}, headers=H).json() == {"status": "ok"}
    assert len(sent) == 1 and "/accesso/" in sent[0]  # unknown address: nothing; repeat: cooldown


def test_history_button_starts_once(admin: TestClient, db: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    import app.routers.admin as admin_router

    started: list[int] = []
    monkeypatch.setattr(admin_router, "_history_in_background", lambda: started.append(1))
    assert admin.post("/admin/history", headers=H).status_code == 202
    db.add(IngestRun(kind="history", scope="italy", status="running"))
    db.commit()
    assert admin.post("/admin/history", headers=H).status_code == 409
    assert admin.get("/admin/stats").json()["storico"] == {"rows": 0, "since": None}


def test_market_page_knows_when_its_data_is_ready(admin: TestClient, db: Any) -> None:
    from datetime import UTC, datetime, timedelta

    assert admin.get("/analytics/overview").json()["market"] == {
        "ready": False,
        "history_loaded": False,
        "running": None,
    }
    now = datetime.now(UTC)
    db.add(IngestRun(kind="history", status="ok", finished_at=now - timedelta(minutes=1)))
    db.add(IngestRun(kind="analytics", status="running"))
    db.commit()
    m = admin.get("/analytics/overview").json()["market"]
    assert m == {"ready": False, "history_loaded": True, "running": "analytics"}
    db.add(IngestRun(kind="analytics", status="ok", finished_at=now))
    db.commit()
    assert admin.get("/analytics/overview").json()["market"]["ready"] is True
