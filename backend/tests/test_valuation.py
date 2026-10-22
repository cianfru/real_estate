from collections import Counter
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import func, select

from app.models import AreaStat, Evento, IngestRun, Lotto, PriceIndex, SavedSearch, StoricoVendita, Tribunale, User
from ingest.analytics import _quarter_range, blind_months, run_analytics
from ingest.valuation import (
    extract_surface,
    hex_center,
    hex_key,
    hex_polygon,
    is_partial_ownership,
    parse_it_number,
    plausible,
    segment_of,
)


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Casa singola della superficie commerciale di mq 196,40 con area", 196.4),
        ("Sup. totale 86 mq) con garage (piano T, Consistenza 15 mq); relitto di terreno (3.514 mq)", 86),
        ("appartamento, superficie commerciale mq 162,50 mq, box singolo, superficie commerciale 9,10 mq", 162.5),
        ("soppalco abusivo (da demolire) di circa 20,00 mq", None),
        ("superficie commerciale di circa mq.149 oltre balconi mq.52,64 c.a.", 149),
        ("sottotetto di mq 195, dei quali mq 25 di altezza", 195),
        ("della superficie commerciale di 1.754,00 mq per la quota", 1754),
        ("nessuna superficie indicata", None),
    ],
)
def test_extract_surface(text: str, expected: float | None) -> None:
    assert extract_surface(text) == expected


def test_extract_surface_land() -> None:
    assert extract_surface("Terreno agricolo seminativo di mq. 3.888", land=True) == 3888
    assert extract_surface("Terreno agricolo seminativo di mq. 3.888") is None


@pytest.mark.parametrize(
    "text,partial",
    [
        ("piena proprietà per la quota di 1/1", False),
        ("quota di 1000/1000", False),
        ("quota di 1/2 di piena proprietà", True),
        ("per la quota di 500/1000", True),
        ("1/3 di piena proprietà su appartamento", True),
        ("nuda proprietà su appartamento", True),
        ("diritto di superficie su area", True),
    ],
)
def test_partial_ownership(text: str, partial: bool) -> None:
    assert is_partial_ownership(text) is partial


def test_numbers_and_segments() -> None:
    assert parse_it_number("1.307") == 1307
    assert parse_it_number("174,85") == 174.85
    assert parse_it_number("627.40") == 627.4
    assert segment_of("IMMOBILE_RESIDENZIALE", "APPARTAMENTO") == "residenziale"
    assert segment_of("IMMOBILE_COMMERCIALE", "GARAGE_AUTORIMESSA") == "box"
    assert segment_of("ALTRA_CATEGORIA", "TERRENO") == "terreni"
    assert segment_of("ALTRA_CATEGORIA", "COMPENDIO_PIGNORATO") is None
    assert plausible("residenziale", 90, 1800)
    assert not plausible("residenziale", 90, 30)


def test_hex_grid_round_trip() -> None:
    k = hex_key(11.8768, 45.4064, 1200)
    lon, lat = hex_center(k, 1200)
    assert hex_key(lon, lat, 1200) == k
    ring = hex_polygon(k, 1200)
    assert len(ring) == 7 and ring[0] == ring[-1]
    # neighbours ~2 km apart fall in different cells
    assert hex_key(11.8768 + 0.04, 45.4064, 1200) != k


# ------------------------------------------------------------------ analytics end to end


def _padova(db: Any) -> Tribunale:
    t = db.scalar(select(Tribunale).where(Tribunale.pvp_code == "0280600097"))
    assert t is not None
    return t


def _history(db: Any, n: int = 12, eur_mq: float = 2000, comune: str = "Padova") -> None:
    start = date.today() - timedelta(days=700)
    # an old sale sets the dataset start, so later first rounds count as first rounds
    db.add(
        StoricoVendita(
            pvp_id=1,
            trib_code="0280600097",
            rge_numero="1",
            lotto_codice="UNICO",
            comune=comune,
            provincia="Padova",
            segment="residenziale",
            superficie=100,
            prezzo_base=Decimal(150000),
            data_vendita=start - timedelta(days=900),
        )
    )
    for i in range(n):
        v = eur_mq * (0.85 + 0.03 * i)  # spread around the median
        db.add(
            StoricoVendita(
                pvp_id=100 + i,
                trib_code="0280600097",
                rge_numero=str(500 + i),
                lotto_codice="UNICO",
                comune=comune,
                provincia="Padova",
                lat=45.4064 + 0.001 * (i % 3),
                lon=11.8768,
                segment="residenziale",
                superficie=100,
                prezzo_base=Decimal(str(round(v * 100))),
                data_vendita=start + timedelta(days=20 * i),
                esito="ASDES",
            )
        )
        # a second, cheaper round of the same lot (auction price, not an appraisal)
        db.add(
            StoricoVendita(
                pvp_id=200 + i,
                trib_code="0280600097",
                rge_numero=str(500 + i),
                lotto_codice="UNICO",
                comune=comune,
                provincia="Padova",
                segment="residenziale",
                superficie=100,
                prezzo_base=Decimal(str(round(v * 75))),
                data_vendita=start + timedelta(days=20 * i + 120),
            )
        )
    db.commit()


def _lot(db: Any, key: str, price: float, surface: float = 100, quota: bool = False) -> Lotto:
    lot = Lotto(
        lot_key=key,
        tribunale_id=_padova(db).id,
        rge_numero=key,
        lotto_codice="UNICO",
        comune="Padova",
        provincia="Padova",
        segment="residenziale",
        superficie_mq=surface,
        superficie_source="pvp",
        prezzo_base=Decimal(str(price)),
        prezzo_primo_esperimento=Decimal(str(price * 1.3)),
        status="active",
        quota_parziale=quota,
        geom="SRID=4326;POINT(11.8768 45.4064)",
        geocode_source="pvp",
        geocode_confidence=0.9,
        data_vendita=None,
    )
    db.add(lot)
    db.commit()
    return lot


def test_analytics_flags_lots_below_zone_value(db: Any) -> None:
    _history(db)
    cheap = _lot(db, "T|1", 120_000)  # 1,200 €/m² vs ~2,030 zone median
    fair = _lot(db, "T|2", 200_000)
    share = _lot(db, "T|3", 90_000, quota=True)

    counts = run_analytics(db)
    db.expire_all()
    cheap, fair, share = db.get(Lotto, cheap.id), db.get(Lotto, fair.id), db.get(Lotto, share.id)

    assert counts["appraisals"] == 12
    assert cheap.zona_level == "hex" and cheap.zona_n == 12
    assert 1950 < float(cheap.zona_eur_mq) < 2100
    assert cheap.sconto_zona_pct and cheap.sconto_zona_pct > 40
    assert cheap.opportunity and not fair.opportunity
    assert share.sconto_zona_pct and share.sconto_zona_pct > 50 and not share.opportunity  # partial ownership
    assert float(cheap.eur_mq) == 1200
    # cheaper than the zone's auctions too (history: appraisals + second rounds at 75%)
    assert cheap.zona_asta_eur_mq and float(cheap.zona_asta_eur_mq) < float(cheap.zona_eur_mq)
    assert cheap.sconto_aste_pct and cheap.sconto_aste_pct >= 25

    hexes = db.scalars(select(AreaStat).where(AreaStat.level == "hex")).all()
    assert hexes and hexes[0].polygon and hexes[0].n_opportunities == 1
    comune = db.scalar(select(AreaStat).where(AreaStat.level == "comune"))
    assert comune.label == "Padova" and comune.n_active == 3
    idx = db.scalars(select(PriceIndex).where(PriceIndex.level == "provincia")).all()
    assert idx and any(p.asta_eur_mq for p in idx) and sum(p.n_deserte for p in idx) == 12

    # first analytics run is silent; a lot becoming an opportunity later is announced once
    assert db.scalar(select(func.count()).select_from(Evento)) == 0
    db.add(IngestRun(kind="analytics", status="ok"))
    fair.prezzo_base = Decimal(125_000)
    db.commit()
    run_analytics(db)
    run_analytics(db)
    events = db.scalars(select(Evento).where(Evento.tipo == "opportunity")).all()
    assert [e.lotto_id for e in events] == [fair.id]


def test_cheap_because_appraised_low_is_not_an_opportunity(db: Any) -> None:
    """A lot whose own appraisal is a third of the zone's is cheap for a reason (or its surface is
    wrong): no opportunity flag."""
    _history(db)
    lot = _lot(db, "T|9", 60_000)
    lot.prezzo_primo_esperimento = Decimal(65_000)  # 650 €/m² appraisal in a ~2,000 €/m² zone
    db.commit()
    run_analytics(db)
    db.expire_all()
    lot = db.get(Lotto, lot.id)
    assert lot.sconto_zona_pct and lot.sconto_zona_pct > 60
    assert not lot.opportunity


def test_analytics_without_history_is_a_no_op(db: Any) -> None:
    assert run_analytics(db) == {"skipped": 1, "reason_no_history": 1}


def test_blind_months_are_coverage_holes_not_quiet_months() -> None:
    per_month: Counter[date] = Counter()
    m = date(2019, 1, 1)
    while m <= date(2026, 10, 1):
        per_month[m] = 1000
        m = date(m.year + (m.month == 12), m.month % 12 + 1, 1)
    for month in (3, 4, 5, 6, 7, 8, 9, 10, 11, 12):  # the 2025 PVP hole
        per_month[date(2025, month, 1)] = 5
    per_month[date(2020, 6, 1)] = 180  # lockdown: quiet but real
    per_month[date(2023, 8, 1)] = 30  # court holidays
    blind = blind_months(per_month, today=date(2026, 10, 22))
    assert blind == {date(2025, m, 1) for m in range(3, 13)}
    assert blind_months(Counter({date(2026, 1, 1): 3, date(2026, 3, 1): 4}), date(2026, 10, 22)) == set()


def test_quarter_range_is_continuous() -> None:
    assert _quarter_range("2024-Q3", "2025-Q2") == ["2024-Q3", "2024-Q4", "2025-Q1", "2025-Q2"]


def test_first_sales_after_a_pvp_hole_are_not_appraisals(db: Any) -> None:
    """After months PVP left empty, a lot's first visible sale may be a reduced later round."""
    rows, pid = [], 10_000
    m = date(2019, 1, 1)
    today = date.today()
    hole = {date(today.year - 1, k, 1) for k in range(1, 7)}
    while m <= today.replace(day=1):
        if m not in hole:
            for _ in range(60):  # national volume, in a segment we never value
                pid += 1
                rows.append(StoricoVendita(pvp_id=pid, trib_code="X", segment="terreni", data_vendita=m))
        m = date(m.year + (m.month == 12), m.month % 12 + 1, 1)
    db.add_all(rows)
    for i, day in enumerate([date(today.year - 2, 3, 10)] * 4 + [date(today.year - 1, 8, 10)] * 4):
        db.add(
            StoricoVendita(
                pvp_id=500 + i,
                trib_code="0280600097",
                rge_numero=str(900 + i),
                lotto_codice="UNICO",
                comune="Padova",
                provincia="Padova",
                segment="residenziale",
                superficie=100,
                prezzo_base=Decimal(200_000),
                data_vendita=day,
            )
        )
    db.commit()
    counts = run_analytics(db)
    assert counts["blind_months"] == 6
    assert counts["appraisals"] == 4 and counts["appraisals_after_blind_months"] == 4
    gaps = db.scalars(select(PriceIndex).where(PriceIndex.gap.is_(True), PriceIndex.level == "italia")).all()
    assert {p.quarter for p in gaps} == {f"{today.year - 1}-Q1", f"{today.year - 1}-Q2"}
    assert all(p.asta_eur_mq is None and p.stima_eur_mq is None for p in gaps)


def test_opportunity_events_reach_the_alert_digest(db: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    """The nightly digest covers the analytics run too, not only the sync run."""
    import app.services.alerts as alerts

    sent: list[str] = []
    monkeypatch.setattr(alerts, "send_email", lambda to, subject, html, text: sent.append(text) or "id")
    user = User(email="a@studio.test", name="A", password_hash="x")
    db.add(user)
    db.flush()
    db.add(SavedSearch(user_id=user.id, name="Padova", criteria={"comune": "Padova"}, alert_enabled=True))
    _history(db)
    lot = _lot(db, "T|5", 200_000)
    first = IngestRun(kind="analytics", status="ok")
    db.add(first)
    db.commit()
    run_analytics(db, run=first)  # bootstrap: nothing below its zone yet, nothing announced
    run = IngestRun(kind="analytics", status="running")
    db.add(run)
    lot.prezzo_base = Decimal(120_000)
    db.commit()
    run_analytics(db, run=run)

    counts = alerts.run_alerts(db, run_ids=[run.id])
    assert counts["emails"] == 1 and counts["items"] == 1
    assert "Sotto il valore di zona" in sent[0]
