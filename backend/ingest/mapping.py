"""Pure functions turning PVP payloads into our column values. No I/O here: everything is
unit-tested against the fixtures in tests/fixtures/pvp/."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo

ROME = ZoneInfo("Europe/Rome")

# ------------------------------------------------------------------ GDPR scrubbing

# Keys removed recursively from every payload before it is stored or saved as a fixture.
PERSONAL_KEYS = {
    "soggetti",  # delegato, custode, giudice: names, phones, emails, tax codes
    "cf",
    "codFiscaleCustode",
    "nomeTitolarePegno",
    "cognomeTitolarePegno",
    "codfisTitolarePegno",
}
_TAX_CODE_KEY = re.compile(r"^(cf|codfis|codicefiscale|codfiscale)", re.I)
_TAX_CODE_VALUE = re.compile(r"\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b")


def scrub(obj: Any) -> Any:
    """Drop personal data. Tax-code-shaped strings anywhere in free text are masked too."""
    if isinstance(obj, dict):
        return {k: scrub(v) for k, v in obj.items() if k not in PERSONAL_KEYS and not _TAX_CODE_KEY.match(k)}
    if isinstance(obj, list):
        return [scrub(v) for v in obj]
    if isinstance(obj, str):
        return _TAX_CODE_VALUE.sub("[CF RIMOSSO]", obj)
    return obj


def stable_hash(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


# ------------------------------------------------------------------ small parsers


def to_decimal(v: Any) -> Decimal | None:
    if v is None or v == "":
        return None
    try:
        d = Decimal(str(v))
    except InvalidOperation:
        return None
    return d.quantize(Decimal("0.01"))


def parse_iso_dt(v: str | None) -> datetime | None:
    """'2027-01-22T11:00' (Europe/Rome wall time)."""
    if not v:
        return None
    try:
        return datetime.fromisoformat(v).replace(tzinfo=ROME)
    except ValueError:
        return None


def parse_it_dt(d: str | None, t: str | None = None) -> datetime | None:
    """'23/10/2026' + '09:00' (Europe/Rome wall time)."""
    if not d:
        return None
    try:
        day = datetime.strptime(d.strip(), "%d/%m/%Y")
    except ValueError:
        return None
    if t:
        try:
            hh, mm = t.strip().split(":")[:2]
            day = day.replace(hour=int(hh), minute=int(mm))
        except ValueError:
            pass
    return day.replace(tzinfo=ROME)


def parse_it_date(d: str | None) -> date | None:
    dt = parse_it_dt(d)
    return dt.date() if dt else None


def parse_iso_date(d: str | None) -> date | None:
    if not d:
        return None
    try:
        return date.fromisoformat(d[:10])
    except ValueError:
        return None


_NUM = re.compile(r"(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,(\d+))?")


def parse_surface(v: Any) -> float | None:
    """'198 mq', '1.250,50 mq', 85 -> float m²."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v) if v > 0 else None
    m = _NUM.search(str(v))
    if not m:
        return None
    whole = re.sub(r"[.\s]", "", m.group(1))
    num = float(f"{whole}.{m.group(2)}" if m.group(2) else whole)
    return num if num > 0 else None


_STIMA = re.compile(
    r"(?:valore\s+(?:di\s+)?stima|prezzo\s+di\s+stima|stimat[oa]\s+in)[^€\d]{0,40}(?:€|euro|eur)?\s*"
    r"(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)",
    re.I,
)


def extract_valore_stima(text: str | None) -> Decimal | None:
    """PVP has no structured 'valore di stima'. Some listings state it in the description."""
    if not text:
        return None
    m = _STIMA.search(text)
    if not m:
        return None
    raw = m.group(1).replace(".", "").replace(",", ".")
    try:
        val = Decimal(raw)
    except InvalidOperation:
        return None
    return val if val >= 1000 else None


def norm_text(s: str | None) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def norm_lotto_code(code: str | None) -> str:
    """'LOTTO UNICO' -> 'UNICO', 'Lotto 3' -> '3', '003' -> '3', None -> 'UNICO'."""
    if not code or not str(code).strip():
        return "UNICO"
    c = str(code).strip().upper()
    c = re.sub(r"^LOTTO\s*(N\.?|NR\.?|NUMERO)?\s*", "", c).strip()
    if c in ("", "UNICO", "U"):
        return "UNICO"
    if c.isdigit():
        return str(int(c))
    return re.sub(r"\s+", " ", c)


def norm_rge(num: str | None) -> str | None:
    if num is None:
        return None
    n = str(num).strip().upper()
    if not n:
        return None
    n = re.sub(r"\s+", "", n)
    m = re.match(r"^0*(\d+)(.*)$", n)
    return (m.group(1) + m.group(2)) if m else n


def make_lot_key(
    trib_code: str, rge_num: str | None, rge_anno: int | None, lotto: str | None, comune: str | None = None
) -> tuple[str, bool]:
    """Lot identity: tribunale + RGE number/year + lot code. The search endpoint does not
    return the RGE year, so list-only rows get a provisional key that includes the comune
    (see docs/data-model.md, 'Lot identity')."""
    n = norm_rge(rge_num) or "?"
    lc = norm_lotto_code(lotto)
    if rge_anno:
        return f"{trib_code}|{n}/{rge_anno}|{lc}", False
    return f"{trib_code}|{n}/?|{lc}|{norm_text(comune)}", True


# ------------------------------------------------------------------ list items

LIST_HASH_FIELDS = (
    "prezzoBaseAsta",
    "offertaMinima",
    "rialzoMinimo",
    "dataOraVendita",
    "esito",
    "descLotto",
    "indirizzo",
    "disponibilita",
    "categoriaBene",
    "categoriaLotto",
    "numeroLotto",
    "procedura",
)


@dataclass
class ListRow:
    pvp_id: int
    trib_code: str
    trib_name: str | None
    rge_numero: str | None
    lotto_codice: str
    tipo_lotto: str | None
    category: str | None
    categorie_bene: list[str]
    indirizzo: str | None
    comune: str | None
    provincia: str | None
    cap: str | None
    lat: float | None
    lon: float | None
    prezzo_base: Decimal | None
    offerta_minima: Decimal | None
    rialzo_minimo: Decimal | None
    data_vendita: datetime | None
    data_pubblicazione: date | None
    occupazione: str | None
    descrizione: str | None
    esito: str | None
    cover_image: str | None
    list_hash: str
    raw: dict[str, Any] = field(repr=False)


# Sales without a court (e.g. Agenzia Entrate-Riscossione "esecuzioni esattoriali") have no
# codiceTribunale/codUfficio: they are grouped under this pseudo-tribunale.
NO_COURT_CODE = "ESATTORIALE"
NO_COURT_NAME = "Vendite esattoriali (senza tribunale)"


def valid_coords(lat: Any, lon: Any) -> tuple[float, float] | None:
    try:
        la, lo = float(lat), float(lon)
    except (TypeError, ValueError):
        return None
    # Italy plus a margin; rejects 0,0 and swapped coordinates.
    if 35.0 <= la <= 47.6 and 6.0 <= lo <= 19.0:
        return la, lo
    return None


def parse_list_item(item: dict[str, Any]) -> ListRow:
    for key in ("id", "codiceTribunale", "prezzoBaseAsta", "dataOraVendita", "indirizzo"):
        if key not in item:
            from ingest.pvp_client import SchemaDriftError

            raise SchemaDriftError(f"search item lost field '{key}'")
    ind = item.get("indirizzo") or {}
    coords = ind.get("coordinate") or {}
    ll = valid_coords(coords.get("latitudine"), coords.get("longitudine"))
    disp = item.get("disponibilita") or []
    clean = scrub(item)
    return ListRow(
        pvp_id=int(item["id"]),
        trib_code=str(item.get("codiceTribunale") or NO_COURT_CODE),
        trib_name=item.get("tribunale") or (NO_COURT_NAME if not item.get("codiceTribunale") else None),
        rge_numero=norm_rge(item.get("procedura")),
        lotto_codice=norm_lotto_code(item.get("numeroLotto")),
        tipo_lotto=item.get("tipoLotto"),
        category=item.get("categoriaLotto"),
        categorie_bene=list(item.get("categoriaBene") or []),
        indirizzo=(ind.get("via") or "").strip() or None,
        comune=(ind.get("citta") or ind.get("descComune") or "").strip() or None,
        provincia=(ind.get("provincia") or ind.get("descProvincia") or "").strip() or None,
        cap=(ind.get("cap") or "").strip() or None,
        lat=ll[0] if ll else None,
        lon=ll[1] if ll else None,
        prezzo_base=to_decimal(item.get("prezzoBaseAsta")),
        offerta_minima=to_decimal(item.get("offertaMinima")),
        rialzo_minimo=to_decimal(item.get("rialzoMinimo")),
        data_vendita=parse_iso_dt(item.get("dataOraVendita")),
        data_pubblicazione=parse_iso_date(item.get("dataPubblicazione")),
        occupazione=disp[0] if disp else None,
        descrizione=item.get("descLotto"),
        esito=item.get("esito"),
        cover_image=item.get("immagineCover") or item.get("immagine"),
        list_hash=stable_hash({k: item.get(k) for k in LIST_HASH_FIELDS}),
        raw=clean,
    )


# ------------------------------------------------------------------ detail

ATTACHMENT_TYPES = {
    "AVEND": "avviso",
    "PERIZ": "perizia",
    "STIMA": "perizia",
    "ORDIN": "ordinanza",
    "PROVV": "ordinanza",
    "IMGBE": "foto",
}


def classify_attachment(code: str | None, desc: str | None, filename: str | None, path: str | None) -> str:
    """The description typed by the delegato is more reliable than PVP's type code (an
    'Avviso di vendita' is often uploaded as ORDIN/PROVV), so keywords win."""
    text = f"{desc or ''} {filename or ''}".lower()
    if "planimetr" in text:
        return "planimetria"
    if "perizia" in text or "stima" in text:
        return "perizia"
    if "avviso" in text:
        return "avviso"
    if "ordinanza" in text or "provvedimento" in text:
        return "ordinanza"
    is_image = (path or "").split("?")[0].lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".gif"))
    if ((path or "").startswith("/immagini-beni/") and is_image) or "foto" in text:
        return "foto"
    return ATTACHMENT_TYPES.get(code or "", "other")


@dataclass
class AttachmentRow:
    pvp_id: int | None
    tipo: str
    pvp_tipo: str | None
    descrizione: str | None
    filename: str | None
    path: str
    size: int | None


@dataclass
class ContactRow:
    role: str
    name: str | None
    email: str | None
    phone: str | None


@dataclass
class DetailRow:
    pvp_id: int
    pvp_lotto_id: int | None
    trib_code: str | None
    trib_name: str | None
    rge_numero: str | None
    rge_anno: int | None
    tipo_procedura: str | None
    lotto_codice: str
    tipo_lotto: str | None
    category: str | None
    subtype: str | None
    categorie_bene: list[str]
    descrizione: str | None
    indirizzo: str | None
    comune: str | None
    provincia: str | None
    provincia_sigla: str | None
    regione: str | None
    cap: str | None
    lat: float | None
    lon: float | None
    superficie_mq: float | None
    vani: float | None
    piano: str | None
    occupazione: str | None
    dati_catastali: list[dict[str, Any]]
    data_vendita: datetime | None
    termine_offerte: datetime | None
    prezzo_base: Decimal | None
    offerta_minima: Decimal | None
    rialzo_minimo: Decimal | None
    modalita: str | None
    tipo_vendita: str | None
    valore_stima: Decimal | None
    stato_pvp: str | None
    esito: str | None
    esito_desc: str | None
    data_conclusione: date | None
    data_pubblicazione: date | None
    deposito_cauzionale: str | None
    siti: list[dict[str, Any]]
    allegati: list[AttachmentRow]
    contacts: list[ContactRow]
    content_hash: str
    raw: dict[str, Any] = field(repr=False)


# SOGGSPV = the person who arranges viewings ("soggetto per la visita").
CONTACT_ROLES = {"DELEGATO", "CUSTODE", "SOGGSPV", "GESTORE", "CURATORE", "LIQUIDATORE", "COMMISSIONARIO"}


def parse_detail(d: dict[str, Any]) -> DetailRow:
    lotto = d.get("lotto") or {}
    proc = d.get("procedura") or {}
    beni = d.get("beni") or []
    first = beni[0] if beni else {}
    ind = lotto.get("indirizzo") or first.get("indirizzo") or {}
    coords = ind.get("coordinate") or {}
    ll = valid_coords(coords.get("latitudine"), coords.get("longitudine"))

    catastali: list[dict[str, Any]] = []
    for i, b in enumerate(beni):
        for dc in b.get("datiCatastali") or []:
            row = {
                "bene": i + 1,
                "sezione": dc.get("textSezione"),
                "foglio": dc.get("textFoglio"),
                "particella": dc.get("textParticella"),
                "subalterno": dc.get("textSubalterno"),
                "graffato": dc.get("textGraffato"),
            }
            catastali.append({k: v for k, v in row.items() if v not in (None, "")})

    allegati: list[AttachmentRow] = []
    seen_paths: set[str] = set()
    for a in list(d.get("allegati") or []) + [a for b in beni for a in (b.get("allegati") or [])]:
        path = a.get("linkAllegato")
        if not path or path in seen_paths:
            continue
        seen_paths.add(path)
        code = a.get("codiceTipoAllegato")
        allegati.append(
            AttachmentRow(
                pvp_id=a.get("idAllegato"),
                tipo=classify_attachment(code, a.get("descrizione"), a.get("nomeFile"), path),
                pvp_tipo=code,
                descrizione=a.get("descrizione"),
                filename=a.get("nomeFile"),
                path=path,
                size=a.get("dimensioneAllegato"),
            )
        )

    contacts = [
        ContactRow(
            role=s.get("ruolo") or "",
            name=" ".join(x for x in (s.get("nome"), s.get("cognome")) if x) or None,
            email=s.get("email"),
            phone=s.get("telefono"),
        )
        for s in d.get("soggetti") or []
        if (s.get("ruolo") or "").upper() in CONTACT_ROLES  # never the judge
    ]

    surface = None
    for b in beni:
        surface = parse_surface(b.get("superficie"))
        if surface:
            break
    vani = next((float(b["numeroVani"]) for b in beni if b.get("numeroVani")), None)
    deposito = (d.get("datiDeposito") or {}).get("depoCauzionale")
    descr = lotto.get("descLotto") or first.get("descrizione")
    clean = scrub(d)
    hash_src = {k: v for k, v in clean.items() if k not in ("siti", "numPagina", "numElementiPagina")}

    anno = proc.get("numeAnnoRg")
    return DetailRow(
        pvp_id=int(d["idVendita"]),
        pvp_lotto_id=lotto.get("idLotto"),
        trib_code=proc.get("codUfficio") or NO_COURT_CODE,
        trib_name=proc.get("descUfficio") or (NO_COURT_NAME if not proc.get("codUfficio") else None),
        rge_numero=norm_rge(proc.get("numeRg")),
        rge_anno=int(anno) if anno else None,
        tipo_procedura=proc.get("descTipoRito"),
        lotto_codice=norm_lotto_code(lotto.get("codLotto")),
        tipo_lotto=lotto.get("codTipoLotto"),
        category=lotto.get("codTipoCategLotto"),
        subtype=first.get("codTipologiaBene"),
        categorie_bene=sorted({b["codTipologiaBene"] for b in beni if b.get("codTipologiaBene")}),
        descrizione=descr,
        indirizzo=(ind.get("via") or "").strip() or None,
        comune=ind.get("descComune") or ind.get("citta"),
        provincia=ind.get("descProvincia") or ind.get("provincia"),
        provincia_sigla=ind.get("codProvincia"),
        regione=ind.get("descRegione"),
        cap=ind.get("cap"),
        lat=ll[0] if ll else None,
        lon=ll[1] if ll else None,
        superficie_mq=surface,
        vani=vani,
        piano=first.get("piano"),
        occupazione=first.get("disponibilita") or first.get("codiceTipoDispBene"),
        dati_catastali=catastali,
        data_vendita=parse_it_dt(d.get("dataVendita"), d.get("oraVendita")),
        termine_offerte=parse_it_dt(d.get("dataTermPresOff"), d.get("oraTermPresOff")),
        prezzo_base=to_decimal(d.get("impoBaseAsta")),
        offerta_minima=to_decimal(d.get("impoOffertaMinima")),
        rialzo_minimo=to_decimal(d.get("impoOffertaAumento")),
        modalita=d.get("codModVendita"),
        tipo_vendita=d.get("codTipoVendita"),
        valore_stima=extract_valore_stima(descr),
        stato_pvp=d.get("flgStatoAnnuncio"),
        esito=d.get("codEsito"),
        esito_desc=d.get("descEsito"),
        data_conclusione=parse_it_date(d.get("dataConclusione")),
        data_pubblicazione=parse_it_date(d.get("dataDiPubblicazione")),
        deposito_cauzionale=deposito,
        siti=[
            {
                "nome": (s.get("link") or "").replace("https://", "").replace("http://", ""),
                "url": s.get("urlInserizione"),
            }
            for s in d.get("siti") or []
            if s.get("urlInserizione")
        ],
        allegati=allegati,
        contacts=contacts,
        content_hash=stable_hash(hash_src),
        raw=clean,
    )
