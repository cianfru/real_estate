from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.auth import hash_password
from app.models import User
from app.server import create_site

H = {"X-Requested-With": "fetch"}


@pytest.fixture
def dist(tmp_path: Path) -> Path:
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><title>shell</title>")
    (tmp_path / "assets" / "index-abc123.js").write_text("console.log(1)")
    (tmp_path / "robots.txt").write_text("User-agent: *\nDisallow: /\n")
    return tmp_path


def test_app_shell_assets_and_api_share_one_origin(dist: Path, db: Any) -> None:
    db.add(User(email="avv@example.org", name="Avvocata", password_hash=hash_password("password-lunga")))
    db.commit()
    c = TestClient(create_site(dist))

    for path in ("/", "/mercato", "/lotti/12", "/s/abc"):
        r = c.get(path)
        assert r.status_code == 200 and "shell" in r.text, path
        assert r.headers["cache-control"] == "no-cache"
        assert r.headers["x-frame-options"] == "DENY" and r.headers["x-robots-tag"] == "noindex, nofollow"

    r = c.get("/assets/index-abc123.js")
    assert r.status_code == 200 and "immutable" in r.headers["cache-control"]
    assert c.get("/assets/missing.js").status_code == 404
    assert c.get("/robots.txt").text.startswith("User-agent")
    assert "shell" in c.get("/%2e%2e/%2e%2e/etc/passwd").text  # never a file outside the build

    # the API lives under /api, with its own auth and CSRF rules
    assert c.get("/api/lotti").status_code == 401
    assert c.post("/api/auth/login", json={"email": "avv@example.org", "password": "password-lunga"}).status_code == 403
    login = {"email": "avv@example.org", "password": "password-lunga"}
    assert c.post("/api/auth/login", json=login, headers=H).status_code == 200
    assert c.get("/api/lotti").status_code == 200
    assert c.get("/api/nope").status_code == 404
    assert c.get("/health").json() == {"status": "ok"}


def test_without_a_build_only_the_api_is_served(tmp_path: Path) -> None:
    c = TestClient(create_site(tmp_path))
    assert c.get("/").status_code == 404
    assert c.get("/api/lotti").status_code == 401


def test_first_admin_from_environment(tmp_path: Path, db: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import get_settings

    s = get_settings()
    monkeypatch.setattr(s, "admin_email", "Avv@Example.org")
    monkeypatch.setattr(s, "admin_password", "password-lunga")
    with TestClient(create_site(tmp_path)) as c:
        r = c.post("/api/auth/login", json={"email": "avv@example.org", "password": "password-lunga"}, headers=H)
        assert r.status_code == 200 and r.json()["is_admin"]
    monkeypatch.setattr(s, "admin_email", "altro@example.org")
    with TestClient(create_site(tmp_path)):
        pass  # users exist: the variables are ignored
    assert [u.email for u in db.query(User).all()] == ["avv@example.org"]
