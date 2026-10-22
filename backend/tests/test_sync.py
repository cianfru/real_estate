from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import func, select

from app.config import get_settings
from app.models import Allegato, ContattoProfessionale, Evento, Lotto, Vendita
from ingest.geocode import GeoResult, geocode_missing
from ingest.mapping import ROME
from ingest.sync import Syncer
from tests.conftest import FakePvp


def events(db: Any, tipo: str | None = None) -> list[Evento]:
    q = select(Evento).order_by(Evento.id)
    if tipo:
        q = q.where(Evento.tipo == tipo)
    return list(db.scalars(q))


def lot_by_pvp(db: Any, pvp_id: int) -> Lotto:
    v = db.scalar(select(Vendita).where(Vendita.pvp_id == pvp_id))
    assert v is not None
    return v.lotto


@pytest.mark.usefixtures("only_padova")
def test_full_sync_builds_lots_rounds_and_history(db: Any, client: Any) -> None:
    res = Syncer(db, client).full_sync("veneto")
    assert not res.errors, res.errors

    # 3 upcoming lots of RGE 93/2024 + 6 other Padova lots
    active = db.scalar(select(func.count()).select_from(Lotto).where(Lotto.status == "active"))
    assert active == 9

    lot = lot_by_pvp(db, 4648963)
    assert lot.lot_key == "0280600097|93/2024|1"
    assert not lot.key_is_provisional
    assert lot.has_detail and lot.rge_anno == 2024
    # history sync attached the deserted May round to the same lot
    pvp_ids = [v.pvp_id for v in lot.vendite]
    assert pvp_ids == [4545157, 4648963]
    assert [v.round_number for v in lot.vendite] == [1, 2]
    assert lot.n_rounds == 2
    assert float(lot.prezzo_primo_esperimento) == 285000
    assert float(lot.prezzo_base) == 214000
    assert lot.vendite[0].esito == "ASDES"
    assert lot.current_vendita_id == lot.vendite[1].id
    assert lot.geom is not None and lot.geocode_source == "pvp"
    assert lot.cover_image_path and lot.cover_image_path.startswith("/immagini-beni/")

    # attachments stored as metadata + PVP path only
    allegati = db.scalars(select(Allegato).where(Allegato.vendita_id == lot.current_vendita_id)).all()
    assert allegati and all(a.path.startswith("/") for a in allegati)

    # first sync ever: silent bootstrap, first_seen taken from the PVP publication date
    assert res.counts["bootstrap"] == 1
    assert not events(db)
    assert lot.first_seen.astimezone(ROME).date().isoformat() == "2026-10-21"


@pytest.mark.usefixtures("only_padova")
def test_new_lot_after_bootstrap_is_announced(db: Any, client: Any, fake_pvp: FakePvp) -> None:
    fake_pvp.hidden.add(4649210)
    Syncer(db, client).full_sync("veneto")
    fake_pvp.hidden.clear()
    Syncer(db, client).full_sync("veneto")
    new = events(db, "new_lot")
    assert [e.lotto_id for e in new] == [lot_by_pvp(db, 4649210).id]
    assert not events(db, "new_round")


@pytest.mark.usefixtures("only_padova")
def test_rerun_is_idempotent(db: Any, client: Any, fake_pvp: FakePvp) -> None:
    Syncer(db, client).full_sync("veneto")
    n_events = len(events(db))
    n_lots = db.scalar(select(func.count()).select_from(Lotto))
    calls = len(fake_pvp.calls)

    res = Syncer(db, client).full_sync("veneto")
    assert len(events(db)) == n_events
    assert db.scalar(select(func.count()).select_from(Lotto)) == n_lots
    # no detail re-fetch when nothing changed; history is fresh too
    detail_calls = [c for c in fake_pvp.calls[calls:] if c[1].endswith("/restricted")]
    assert detail_calls == []
    assert res.counts.get("details_fetched", 0) == 0


@pytest.mark.usefixtures("only_padova")
def test_price_and_deadline_changes_create_events(db: Any, client: Any, fake_pvp: FakePvp) -> None:
    Syncer(db, client).full_sync("veneto")
    item = dict(fake_pvp.list_items[4648963])
    item["prezzoBaseAsta"] = 200000.0
    fake_pvp.overrides[4648963] = {**item, "detail": {"impoBaseAsta": 200000, "dataTermPresOff": "15/12/2026"}}

    Syncer(db, client).full_sync("veneto")
    drops = events(db, "price_drop")
    assert len(drops) == 1
    assert drops[0].old == {"prezzo_base": 214000.0} and drops[0].new == {"prezzo_base": 200000.0}
    assert len(events(db, "deadline_changed")) == 1
    assert float(lot_by_pvp(db, 4648963).prezzo_base) == 200000


@pytest.mark.usefixtures("only_padova")
def test_new_round_links_to_existing_lot(db: Any, client: Any, fake_pvp: FakePvp) -> None:
    Syncer(db, client).full_sync("veneto")
    lot = lot_by_pvp(db, 4648963)
    # PVP publishes a third round with a new id and a lower price
    new_item = dict(
        fake_pvp.list_items[4648963],
        id=4700001,
        prezzoBaseAsta=160500.0,
        offertaMinima=120375.0,
        dataVendita="2027-02-10",
        dataOraVendita="2027-02-10T10:00",
    )
    fake_pvp.list_items[4700001] = new_item
    fake_pvp.history["body"]["content"].append(new_item)
    Syncer(db, client).full_sync("veneto")

    db.expire_all()
    assert lot_by_pvp(db, 4700001).id == lot.id
    assert len(events(db, "new_round")) == 1
    assert len(events(db, "price_drop")) == 1
    lot = db.get(Lotto, lot.id)
    assert lot.n_rounds == 3


@pytest.mark.usefixtures("only_padova")
def test_unseen_lots_become_unknown(db: Any, client: Any, fake_pvp: FakePvp) -> None:
    Syncer(db, client).full_sync("veneto")
    fake_pvp.hidden.add(4649048)
    n = get_settings().unseen_runs_before_unknown
    for _ in range(n):
        Syncer(db, client).full_sync("veneto", with_details=False)
    db.expire_all()
    assert lot_by_pvp(db, 4649048).status == "unknown"
    assert len(events(db, "cancelled")) == 1
    # never hard-deleted
    assert db.scalar(select(Vendita).where(Vendita.pvp_id == 4649048)) is not None


@pytest.mark.usefixtures("only_padova")
def test_professional_contacts_only_with_flag(db: Any, client: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    Syncer(db, client).full_sync("veneto")
    assert db.scalar(select(func.count()).select_from(ContattoProfessionale)) == 0

    s = get_settings().model_copy(update={"store_professional_contacts": True})
    v = db.scalar(select(Vendita).where(Vendita.pvp_id == 4648963))
    Syncer(db, client, settings=s).fetch_and_apply_detail(v)
    db.commit()
    roles = {c.role for c in db.scalars(select(ContattoProfessionale))}
    assert roles == {"DELEGATO", "SOGGSPV"}  # never the judge


@pytest.mark.usefixtures("only_padova")
def test_raw_payloads_contain_no_personal_data(db: Any, client: Any) -> None:
    Syncer(db, client).full_sync("veneto")
    for v in db.scalars(select(Vendita)):
        blob = str(v.raw or "") + str(v.raw_list or "")
        assert "RSSMRA80A01H501U" not in blob
        assert "Cognome1" not in blob
        assert "'soggetti'" not in blob


def test_provisional_key_is_confirmed_by_detail(db: Any, client: Any, fake_pvp: FakePvp) -> None:
    """National list rows (no RGE year) get a provisional key; the detail fixes it."""
    s = Syncer(db, client)
    from ingest.mapping import parse_list_item

    v = s.upsert_from_list(parse_list_item(fake_pvp.list_items[4648963]))
    db.commit()
    assert v.lotto.key_is_provisional
    s.fetch_and_apply_detail(v)
    db.commit()
    db.expire_all()
    lot = lot_by_pvp(db, 4648963)
    assert lot.lot_key == "0280600097|93/2024|1" and not lot.key_is_provisional


class FakeGeocoder:
    name = "nominatim"

    def __init__(self) -> None:
        self.queries: list[Any] = []

    def geocode(self, query: Any) -> GeoResult | None:
        self.queries.append(query)
        text = query if isinstance(query, str) else query["street"]
        if "inesistente" in text.lower():
            return None
        return GeoResult(45.4, 11.87, 0.8)


def test_geocode_with_comune_fallback_and_cache(db: Any, client: Any, fake_pvp: FakePvp) -> None:
    from ingest.mapping import parse_list_item

    s = Syncer(db, client)
    item = dict(fake_pvp.list_items[4648963])
    item["indirizzo"] = {**item["indirizzo"], "coordinate": None, "via": "Via Inesistente 1"}
    s.upsert_from_list(parse_list_item(item))
    item2 = dict(fake_pvp.list_items[4649059], indirizzo={**item["indirizzo"], "via": "Via Roma 3"})
    s.upsert_from_list(parse_list_item(item2))
    db.commit()

    g = FakeGeocoder()
    counts = geocode_missing(db, geocoder=g)
    assert counts == {"candidates": 2, "geocoded_comune": 1, "geocoded_nominatim": 1}
    approx = lot_by_pvp(db, 4648963)
    assert approx.geocode_source == "comune" and approx.geocode_confidence == 0.2

    # second run: nothing left, and cached queries are not repeated
    before = len(g.queries)
    geocode_missing(db, geocoder=g)
    assert len(g.queries) == before
