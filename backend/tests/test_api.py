from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth import hash_password
from app.main import app
from app.models import AlertLog, User, Vendita
from ingest.sync import Syncer

H = {"X-Requested-With": "fetch"}


@pytest.fixture
def synced(db: Any, client: Any, only_padova: None) -> None:
    Syncer(db, client).full_sync("veneto")


@pytest.fixture
def api(db: Any) -> TestClient:
    db.add(User(email="avv@example.org", name="Avvocata", password_hash=hash_password("password-lunga"), is_admin=True))
    db.commit()
    c = TestClient(app)
    r = c.post("/auth/login", json={"email": "avv@example.org", "password": "password-lunga"}, headers=H)
    assert r.status_code == 200, r.text
    return c


def lot_id(db: Any, pvp_id: int) -> int:
    v = db.scalar(select(Vendita).where(Vendita.pvp_id == pvp_id))
    return v.lotto_id


def test_auth_required() -> None:
    c = TestClient(app)
    assert c.get("/lotti").status_code == 401
    assert c.post("/auth/login", json={"email": "x@example.org", "password": "nope"}, headers=H).status_code == 401


def test_csrf_header_required(api: TestClient) -> None:
    assert api.post("/clienti", json={"display_name": "Rossi"}).status_code == 403
    assert api.post("/clienti", json={"display_name": "Rossi"}, headers=H).status_code == 200


@pytest.mark.usefixtures("synced")
def test_list_filters_and_sort(api: TestClient, db: Any) -> None:
    r = api.get("/lotti", params={"sort": "prezzo_asc", "page_size": 100})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 9
    prices = [i["prezzo_base"] for i in body["items"]]
    assert prices == sorted(prices)

    r = api.get("/lotti", params={"price_max": 100000})
    assert all(i["prezzo_base"] <= 100000 for i in r.json()["items"])

    r = api.get("/lotti", params={"price_dropped": "true"})
    ids = {i["id"] for i in r.json()["items"]}
    assert lot_id(db, 4648963) in ids
    item = next(i for i in r.json()["items"] if i["id"] == lot_id(db, 4648963))
    assert item["ribasso_pct"] == pytest.approx(24.9, abs=0.1)
    assert item["rge"] == "93/2024"

    r = api.get("/lotti", params={"comune": "anguillara"})
    assert r.json()["total"] == 3

    poly = {"type": "Polygon", "coordinates": [[[11.0, 45.0], [12.2, 45.0], [12.2, 45.2], [11.0, 45.2], [11.0, 45.0]]]}
    r = api.get("/lotti", params={"polygon": json.dumps(poly)})
    assert r.status_code == 200
    assert all(45.0 <= i["lat"] <= 45.2 for i in r.json()["items"])

    r = api.get("/lotti", params={"bbox": "11,45,12.2,45.2"})
    assert r.json()["total"] == len(r.json()["items"])


@pytest.mark.usefixtures("synced")
def test_geojson(api: TestClient) -> None:
    r = api.get("/lotti/geojson")
    fc = r.json()
    with_coords = api.get("/lotti", params={"has_coords": "true"}).json()["total"]
    assert fc["type"] == "FeatureCollection" and len(fc["features"]) == with_coords > 0
    assert set(fc["features"][0]["properties"]) == {"id", "c", "p", "a", "t", "m"}


@pytest.mark.usefixtures("synced")
def test_detail_card(api: TestClient, db: Any) -> None:
    r = api.get(f"/lotti/{lot_id(db, 4648963)}")
    assert r.status_code == 200
    d = r.json()
    assert d["tribunale_name"] == "Tribunale di PADOVA"
    assert [x["pvp_id"] for x in d["rounds"]] == [4545157, 4648963]
    assert d["rounds"][1]["drop_pct"] == pytest.approx(24.9, abs=0.1)
    assert d["rounds"][0]["esito"] == "ASDES"
    assert d["allegati"] and d["allegati"][0]["url"].startswith("https://resource-pvp.giustizia.it/")
    assert d["pvp_url"].endswith("4648963")
    assert d["contatti"] == []  # flag off
    assert d["eventi"] == []  # bootstrap sync is silent


@pytest.mark.usefixtures("synced")
def test_notes_clients_and_share(api: TestClient, db: Any) -> None:
    lid = lot_id(db, 4648963)
    assert api.post(f"/lotti/{lid}/note", json={"text": "Visto il 3/11, buono stato"}, headers=H).status_code == 200
    cli = api.post("/clienti", json={"display_name": "Famiglia R."}, headers=H).json()
    link = api.post(f"/lotti/{lid}/clienti", json={"cliente_id": cli["id"]}, headers=H).json()
    assert link["status"] == "in_valutazione"
    r = api.patch(f"/lotti/{lid}/clienti/{link['id']}", json={"status": "offerta_presentata"}, headers=H)
    assert r.json()["status"] == "offerta_presentata"
    clienti = api.get("/clienti").json()
    assert clienti[0]["lotti"][0]["lotto_id"] == lid

    share = api.post(f"/lotti/{lid}/share", headers=H).json()
    anon = TestClient(app)
    pub = anon.get(f"/public/lotti/{share['token']}")
    assert pub.status_code == 200
    body = pub.json()
    text = json.dumps(body)
    assert "Visto il 3/11" not in text and "Famiglia R." not in text
    assert "note" not in body and "clienti" not in body and "contatti" not in body
    assert body["prezzo_base"] == 214000

    api.post(f"/lotti/{lid}/share/{share['id']}/revoke", headers=H)
    assert anon.get(f"/public/lotti/{share['token']}").status_code == 404


def test_public_rate_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "public_rate_limit_per_min", 3)
    anon = TestClient(app)
    codes = [anon.get("/public/lotti/nope", headers={"X-Forwarded-For": "203.0.113.9"}).status_code for _ in range(5)]
    assert codes[:3] == [404, 404, 404] and codes[-1] == 429


@pytest.mark.usefixtures("only_padova")
def test_saved_search_alerts_are_sent_once(
    api: TestClient, db: Any, client: Any, fake_pvp: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    sent: list[tuple[str, str]] = []
    import app.services.alerts as alerts

    monkeypatch.setattr(alerts, "send_email", lambda to, subject, html, text: sent.append((to, text)) or "id-1")
    r = api.post(
        "/saved-searches",
        json={"name": "Anguillara", "criteria": {"comune": "Anguillara"}, "alert_enabled": True},
        headers=H,
    )
    assert r.status_code == 200

    from app.models import IngestRun

    # bootstrap without the Anguillara lots, then they appear on PVP
    anguillara = {4649048, 4649059, 4648963}
    fake_pvp.hidden |= anguillara
    Syncer(db, client).full_sync("veneto")
    fake_pvp.hidden -= anguillara
    run = IngestRun(kind="sync", scope="veneto", status="ok")
    db.add(run)
    db.commit()
    Syncer(db, client, run=run).full_sync("veneto")

    counts = alerts.run_alerts(db, run_id=run.id)
    assert counts["emails"] == 1 and counts["items"] == 3
    assert len(sent) == 1 and "Anguillara" in sent[0][1]
    assert db.scalar(select(AlertLog.id)) is not None

    again = alerts.run_alerts(db, run_id=run.id)
    assert again["emails"] == 0

    lst = api.get("/saved-searches").json()
    assert lst[0]["match_count"] == 3


@pytest.mark.usefixtures("synced")
def test_admin_endpoints(api: TestClient) -> None:
    runs = api.get("/admin/runs").json()
    assert isinstance(runs, list)
    stats = api.get("/admin/stats").json()
    assert stats["lotti_by_status"]["active"] == 9
    meta = api.get("/meta").json()
    assert meta["tribunali"][0]["active_for_enrichment"]
    assert "IMMOBILE_RESIDENZIALE" in meta["categorie"]


def test_image_passthrough_only_allows_listing_photos() -> None:
    anon = TestClient(app)
    assert anon.get("/public/img", params={"path": "/allegati/1/perizia.pdf"}).status_code == 400
    assert anon.get("/public/img", params={"path": "/immagini-beni/1/2/../../allegati/x.jpg"}).status_code == 400
    assert anon.get("/public/img", params={"path": "/immagini-beni/1/2/doc.pdf"}).status_code == 400


@pytest.mark.usefixtures("synced")
def test_cover_url_points_to_passthrough(api: TestClient, db: Any) -> None:
    d = api.get(f"/lotti/{lot_id(db, 4648963)}").json()
    assert d["cover_url"].startswith("/public/img?path=%2Fimmagini-beni%2F")
