from decimal import Decimal

import pytest

from ingest.geocode import normalise_address
from ingest.mapping import (
    classify_attachment,
    extract_valore_stima,
    make_lot_key,
    norm_lotto_code,
    norm_rge,
    parse_detail,
    parse_list_item,
    parse_surface,
    scrub,
)
from ingest.pvp_client import SchemaDriftError
from tests.conftest import fixture


def test_parse_list_item() -> None:
    item = fixture("search_history_93_2024.json")["body"]["content"][2]
    row = parse_list_item(item)
    assert row.pvp_id == 4648963
    assert row.trib_code == "0280600097"
    assert row.rge_numero == "93"
    assert row.lotto_codice == "1"
    assert row.prezzo_base == Decimal("214000.00")
    assert row.data_vendita is not None and row.data_vendita.isoformat().startswith("2026-12-17")
    assert row.comune == "Anguillara Veneta"
    assert row.lat is not None and 44 < row.lat < 46


def test_parse_list_item_schema_drift() -> None:
    item = dict(fixture("search_history_93_2024.json")["body"]["content"][0])
    del item["prezzoBaseAsta"]
    with pytest.raises(SchemaDriftError):
        parse_list_item(item)


def test_parse_detail_maps_fields_and_drops_personal_data() -> None:
    d = parse_detail(fixture("detail_4601150.json")["body"])
    assert d.pvp_id == 4601150
    assert d.trib_code == "0260860099"
    assert (d.rge_numero, d.rge_anno, d.lotto_codice) == ("158", 2024, "1")
    assert d.modalita == "VENDMIS"
    assert d.termine_offerte is not None and d.termine_offerte.hour == 13
    assert d.superficie_mq == 198
    assert d.occupazione == "OCCUP"
    assert d.comune == "Treviso" and d.provincia_sigla == "TV"
    assert {a.tipo for a in d.allegati} >= {"avviso", "perizia", "ordinanza", "foto"}
    assert d.dati_catastali and d.dati_catastali[0]["foglio"] == "1"
    # the judge is never kept as a contact
    assert {c.role for c in d.contacts} == {"DELEGATO", "CUSTODE"}
    raw = str(d.raw)
    assert "soggetti" not in d.raw and "codFiscaleCustode" not in d.raw
    assert "RSSMRA80A01H501U" not in raw and "Cognome1" not in raw


def test_parse_detail_outcome() -> None:
    d = parse_detail(fixture("detail_4545157.json")["body"])
    assert d.esito == "ASDES"
    assert d.stato_pvp == "C"


def test_scrub_masks_tax_codes_in_text() -> None:
    out = scrub({"descrizione": "intestato a RSSMRA80A01H501U", "codiceFiscale": "x", "nested": [{"cf": "y"}]})
    assert out == {"descrizione": "intestato a [CF RIMOSSO]", "nested": [{}]}


@pytest.mark.parametrize(
    "raw,expected",
    [("LOTTO UNICO", "UNICO"), ("Lotto 3", "3"), ("003", "3"), (None, "UNICO"), ("2 bis", "2 BIS"), ("A", "A")],
)
def test_norm_lotto_code(raw: str | None, expected: str) -> None:
    assert norm_lotto_code(raw) == expected


def test_norm_rge() -> None:
    assert norm_rge(" 0093 ") == "93"
    assert norm_rge("93/1") == "93/1"


def test_lot_key() -> None:
    assert make_lot_key("0280600097", "93", 2024, "Lotto 1") == ("0280600097|93/2024|1", False)
    key, prov = make_lot_key("0280600097", "93", None, "1", "Anguillara Veneta")
    assert prov and key == "0280600097|93/?|1|anguillara veneta"


@pytest.mark.parametrize(
    "raw,expected", [("198 mq", 198), ("1.250,50 mq", 1250.5), (85, 85), ("n.d.", None), (None, None)]
)
def test_parse_surface(raw: object, expected: float | None) -> None:
    assert parse_surface(raw) == expected


def test_valore_stima() -> None:
    assert extract_valore_stima("Valore di stima: € 185.000,00. Libero") == Decimal("185000.00")
    assert extract_valore_stima("prezzo base 100.000") is None


def test_classify_attachment() -> None:
    assert classify_attachment("ALTRO", "Planimetria catastale", "x.pdf", "/allegati/1/x.pdf") == "planimetria"
    assert classify_attachment("STIMA", "Perizia", "p.pdf", "/allegati/1/p.pdf") == "perizia"
    assert classify_attachment(None, None, "a.jpg", "/immagini-beni/1/2/a.jpg") == "foto"
    assert classify_attachment("ALTRO", "Varie", "z.zip", "/allegati/1/z.zip") == "other"


def test_normalise_address() -> None:
    q = normalise_address("V.le della Repubblica n. 12 piano 2 int. 4", "Padova", "Padova", "35100")
    assert q == "viale della repubblica 12, 35100 Padova, Padova, Italia"
    q2 = normalise_address("Via Atene, 88, 06083 Bastia Umbra PG, Italia", "Bastia Umbra", "Perugia", "06083")
    assert q2 == "via atene, 88, 06083 Bastia Umbra, Perugia, Italia"
