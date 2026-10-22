"""Test setup: a dedicated Postgres database (TEST_DATABASE_URL), migrated with Alembic, and a
fake PVP served from the recorded fixtures in tests/fixtures/pvp/."""

from __future__ import annotations

import copy
import json
import os
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Any

os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://postgres@localhost:5432/aste_test"
)
os.environ["JWT_SECRET"] = "test-secret-that-is-long-enough-for-hs256"
os.environ["RESEND_API_KEY"] = ""
os.environ["PVP_MIN_INTERVAL_S"] = "0"

import httpx  # noqa: E402
import pytest  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import text  # noqa: E402

from alembic import command  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures" / "pvp"
TODAY = date(2026, 10, 22)  # the fixtures were recorded on this day


def fixture(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text())


@pytest.fixture(scope="session", autouse=True)
def _migrate() -> None:
    cfg = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    cfg.set_main_option("script_location", str(Path(__file__).parents[1] / "alembic"))
    with engine.begin() as c:
        c.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    command.upgrade(cfg, "head")


TABLES = (
    "area_stats",
    "price_index",
    "storico_vendite",
    "alert_log",
    "share_links",
    "note",
    "lotto_cliente",
    "clienti",
    "saved_searches",
    "users",
    "eventi",
    "contatti_professionali",
    "allegati",
    "vendite",
    "lotti",
    "ingest_runs",
    "geocode_cache",
)


@pytest.fixture(autouse=True)
def _clean(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    import ingest.sync

    monkeypatch.setattr(ingest.sync, "today_rome", lambda: TODAY)
    with engine.begin() as c:
        c.execute(text("UPDATE lotti SET current_vendita_id = NULL"))
        c.execute(text(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE"))
        c.execute(text("DELETE FROM tribunali WHERE region IS DISTINCT FROM 'Veneto'"))
    yield


@pytest.fixture
def db() -> Iterator[Any]:
    s = SessionLocal()
    yield s
    s.close()


class FakePvp:
    """Routes PVP URLs to fixtures. Unknown sale ids get a detail cloned from a real one."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, Any]] = []
        self.history = fixture("search_history_93_2024.json")
        self.padova = fixture("search_padova_upcoming.json")
        self.overrides: dict[int, dict[str, Any]] = {}
        self.list_items: dict[int, dict[str, Any]] = {
            x["id"]: x for x in self.history["body"]["content"] + self.padova["body"]["content"]
        }
        self.hidden: set[int] = set()

    def upcoming_padova(self) -> list[dict[str, Any]]:
        rows = [x for x in self.history["body"]["content"] if x["dataVendita"] >= TODAY.isoformat()]
        rows += self.padova["body"]["content"]
        rows = [self.overrides.get(x["id"], x) for x in rows if x["id"] not in self.hidden]
        return sorted(rows, key=lambda x: x["dataOraVendita"], reverse=True)

    def page(self, rows: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "messaggio": "ok",
            "error": None,
            "body": {"content": rows, "totalElements": len(rows), "last": True, "number": 0},
        }

    def detail(self, pvp_id: int) -> dict[str, Any] | None:
        f = FIXTURES / f"detail_{pvp_id}.json"
        if f.exists():
            d = json.loads(f.read_text())
        elif pvp_id in self.list_items:
            item = self.list_items[pvp_id]
            d = copy.deepcopy(fixture("detail_4648963.json"))
            b = d["body"]
            b["idVendita"] = pvp_id
            b["lotto"]["codLotto"] = item["numeroLotto"]
            b["lotto"]["idLotto"] = 9_000_000 + pvp_id % 100000
            b["impoBaseAsta"] = item["prezzoBaseAsta"]
            b["impoOffertaMinima"] = item["offertaMinima"]
            y, m, dd = item["dataVendita"].split("-")
            b["dataVendita"] = f"{dd}/{m}/{y}"
            b["oraVendita"] = item["orarioVendita"]
            if item["id"] not in [x["id"] for x in self.history["body"]["content"]]:
                b["procedura"]["numeRg"] = item["procedura"]
                b["procedura"]["numeAnnoRg"] = 2020
                b["lotto"]["indirizzo"]["coordinate"] = item["indirizzo"]["coordinate"]
                b["lotto"]["indirizzo"]["descComune"] = item["indirizzo"]["citta"]
        else:
            return None
        if pvp_id in self.overrides and "detail" in self.overrides[pvp_id]:
            d["body"].update(self.overrides[pvp_id]["detail"])
        return d

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        body = json.loads(request.content) if request.content else None
        self.calls.append((request.method, path, body))
        if path.endswith("/fe-config/pvp"):
            return httpx.Response(200, json=fixture("fe_config.json"))
        if path.endswith("/ricerca/vendite"):
            if body.get("procedura"):
                return httpx.Response(200, json=self.history)
            if body.get("tribunale") == "Tribunale di PADOVA":
                return httpx.Response(200, json=self.page(self.upcoming_padova()))
            return httpx.Response(200, json=self.page([]))
        if path.endswith("/tribunali"):
            return httpx.Response(200, json=fixture("tribunali.json"))
        if "/vendite-precedenti" in path:
            return httpx.Response(200, json={"messaggio": "ok", "body": [], "error": None})
        if path.endswith("/restricted"):
            pvp_id = int(path.split("/")[-2])
            d = self.detail(pvp_id)
            return httpx.Response(200, json=d) if d else httpx.Response(404, json={"error": "not found"})
        return httpx.Response(404)


@pytest.fixture
def fake_pvp() -> FakePvp:
    return FakePvp()


@pytest.fixture
def client(fake_pvp: FakePvp) -> Iterator[Any]:
    from ingest.pvp_client import PvpClient

    c = PvpClient(transport=httpx.MockTransport(fake_pvp.handler))
    yield c
    c.close()


@pytest.fixture
def only_padova(db: Any) -> None:
    db.execute(text("UPDATE tribunali SET active_for_enrichment = (name = 'Tribunale di PADOVA')"))
    db.commit()
