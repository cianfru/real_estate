from __future__ import annotations

import re
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth import hash_password
from app.main import app
from app.models import Lotto, PasswordToken, User
from ingest.sync import Syncer

H = {"X-Requested-With": "fetch"}


@pytest.fixture
def staff(db: Any, client: Any, only_padova: None) -> TestClient:
    Syncer(db, client).full_sync("veneto")
    db.add(User(email="avv@example.org", name="Avvocata", password_hash=hash_password("password-lunga"), is_admin=True))
    db.commit()
    c = TestClient(app)
    assert (
        c.post("/auth/login", json={"email": "avv@example.org", "password": "password-lunga"}, headers=H).status_code
        == 200
    )
    return c


def _accept(link: str, password: str = "frase-del-cliente") -> TestClient:
    token = re.search(r"/accesso/([\w-]+)$", link).group(1)  # type: ignore[union-attr]
    c = TestClient(app)
    assert c.post(f"/auth/token/{token}", json={"password": password}, headers=H).status_code == 200
    return c


def _setup(staff: TestClient, db: Any) -> tuple[int, list[int], TestClient]:
    """A client with three linked lots (one hidden) and an accepted login; another client's lot."""
    lots = list(db.scalars(select(Lotto.id).order_by(Lotto.id).limit(4)))
    cid = staff.post("/clienti", json={"display_name": "Famiglia R."}, headers=H).json()["id"]
    other = staff.post("/clienti", json={"display_name": "Altri"}, headers=H).json()["id"]
    links = [staff.post(f"/lotti/{lid}/clienti", json={"cliente_id": cid}, headers=H).json() for lid in lots[:3]]
    staff.post(f"/lotti/{lots[3]}/clienti", json={"cliente_id": other}, headers=H)
    staff.patch(f"/lotti/{lots[1]}/clienti/{links[1]['id']}", json={"nel_portale": False}, headers=H)
    r = staff.patch(
        f"/lotti/{lots[0]}/clienti/{links[0]['id']}",
        json={"nota_cliente": "Visita fissata giovedì alle 10.", "status": "offerta_presentata"},
        headers=H,
    )
    assert r.json()["nota_cliente"] == "Visita fissata giovedì alle 10." and r.json()["status"] == "offerta_presentata"

    inv = staff.post(f"/clienti/{cid}/accounts", json={"name": "Rosa Rossi", "email": "rosa@example.org"}, headers=H)
    assert inv.status_code == 201 and inv.json()["purpose"] == "invite"
    return cid, lots, _accept(inv.json()["link"])


def test_client_sees_only_their_visible_properties(staff: TestClient, db: Any) -> None:
    cid, lots, rosa = _setup(staff, db)

    me = rosa.get("/auth/me").json()
    assert me["role"] == "client" and me["cliente_name"] == "Famiglia R." and me["is_admin"] is False

    items = rosa.get("/portale/immobili").json()
    assert sorted(i["lotto_id"] for i in items) == sorted([lots[0], lots[2]])  # lots[1] hidden, lots[3] not theirs
    first = next(i for i in items if i["lotto_id"] == lots[0])
    assert first["stato"] == "offerta_presentata" and first["nota_cliente"].startswith("Visita")

    card = rosa.get(f"/portale/immobili/{lots[0]}").json()
    assert card["titolo"] and card["nota_cliente"] and "note" not in card and "clienti" not in card
    assert rosa.get(f"/portale/immobili/{lots[1]}").status_code == 404
    assert rosa.get(f"/portale/immobili/{lots[3]}").status_code == 404

    # the staff card knows the client can see it
    detail = staff.get(f"/lotti/{lots[0]}").json()
    assert detail["clienti"][0]["portal_access"] is True and detail["clienti"][0]["nel_portale"] is True


def test_a_client_login_reaches_nothing_of_the_firm(staff: TestClient, db: Any) -> None:
    cid, lots, rosa = _setup(staff, db)
    for path in (
        "/lotti",
        f"/lotti/{lots[0]}",
        "/lotti/geojson",
        "/meta",
        "/clienti",
        "/ricerche",
        "/saved-searches",
        "/admin/stats",
        "/admin/users",
        "/analytics/overview",
    ):
        assert rosa.get(path).status_code in (403, 404), path
    assert rosa.get("/lotti").status_code == 403
    assert rosa.post("/clienti", json={"display_name": "x"}, headers=H).status_code == 403
    assert rosa.post(f"/lotti/{lots[0]}/note", json={"text": "x"}, headers=H).status_code == 403
    assert staff.get("/portale/immobili").status_code == 403
    # client logins are not staff: not in the people list, not manageable there
    emails = [u["email"] for u in staff.get("/admin/users").json()]
    assert "rosa@example.org" not in emails
    uid = db.scalar(select(User.id).where(User.email == "rosa@example.org"))
    assert staff.patch(f"/admin/users/{uid}", json={"is_admin": True}, headers=H).status_code == 404


def test_staff_manage_client_logins(staff: TestClient, db: Any) -> None:
    cid, lots, rosa = _setup(staff, db)
    acc = staff.get(f"/clienti/{cid}").json()["accounts"]
    assert [a["email"] for a in acc] == ["rosa@example.org"] and not acc[0]["pending_invite"]
    uid = acc[0]["id"]

    assert (
        staff.patch(f"/clienti/{cid}/accounts/{uid}", json={"is_active": False}, headers=H).json()["is_active"] is False
    )
    assert rosa.get("/portale/immobili").status_code == 401
    staff.patch(f"/clienti/{cid}/accounts/{uid}", json={"is_active": True}, headers=H)
    reset = staff.post(f"/clienti/{cid}/accounts/{uid}/link", headers=H).json()
    assert reset["purpose"] == "reset"
    _accept(reset["link"], "una-nuova-frase").get("/portale/immobili").raise_for_status()

    assert staff.delete(f"/clienti/{cid}/accounts/{uid}", headers=H).status_code == 204
    assert db.get(User, uid) is None and db.scalar(select(PasswordToken.id).where(PasswordToken.user_id == uid)) is None

    # deleting the client erases its logins too
    inv = staff.post(f"/clienti/{cid}/accounts", json={"name": "Mario Rossi", "email": "mario@example.org"}, headers=H)
    assert inv.status_code == 201
    assert (
        staff.post(
            f"/clienti/{cid}/accounts", json={"name": "Doppio", "email": "MARIO@example.org"}, headers=H
        ).status_code
        == 409
    )
    staff.delete(f"/clienti/{cid}", headers=H)
    db.expire_all()
    assert db.scalar(select(User.id).where(User.email == "mario@example.org")) is None
