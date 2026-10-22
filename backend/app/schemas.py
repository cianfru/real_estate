"""Pydantic schemas. `LottoFilters` is shared by GET /lotti, the map layer and saved searches,
so adding a filter in one place makes it available everywhere (see docs/decisions.md)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

SortKey = Literal["data_vendita", "termine", "prezzo_asc", "prezzo_desc", "ribasso", "nuovi", "superficie"]


class LottoFilters(BaseModel):
    model_config = ConfigDict(extra="ignore")

    q: str | None = None
    tribunale: list[int] = Field(default_factory=list)
    comune: str | None = None
    provincia: list[str] = Field(default_factory=list)
    category: list[str] = Field(default_factory=list)
    tipologia: list[str] = Field(default_factory=list)
    price_min: float | None = None
    price_max: float | None = None
    surface_min: float | None = None
    surface_max: float | None = None
    deadline_from: date | None = None
    deadline_to: date | None = None
    occupazione: list[str] = Field(default_factory=list)
    modalita: list[str] = Field(default_factory=list)
    status: list[str] = Field(default_factory=lambda: ["active"])
    bbox: str | None = None  # "west,south,east,north"
    polygon: dict[str, Any] | None = None  # GeoJSON Polygon / MultiPolygon geometry
    has_coords: bool | None = None
    new_days: int | None = None
    price_dropped: bool | None = None
    min_rounds: int | None = None

    @field_validator("bbox")
    @classmethod
    def _bbox(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        parts = v.split(",")
        if len(parts) != 4:
            raise ValueError("bbox must be west,south,east,north")
        [float(p) for p in parts]
        return v

    @field_validator("polygon")
    @classmethod
    def _polygon(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        if v is None:
            return None
        if v.get("type") == "Feature":
            v = v.get("geometry") or {}
        if v.get("type") not in ("Polygon", "MultiPolygon"):
            raise ValueError("polygon must be a GeoJSON Polygon or MultiPolygon")
        return v


class TribunaleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    pvp_code: str
    name: str
    short_name: str
    region: str | None
    active_for_enrichment: bool


class TribunaleBrief(BaseModel):
    id: int
    short_name: str


class LottoListItem(BaseModel):
    id: int
    tribunale: TribunaleBrief
    rge: str | None
    lotto_codice: str | None
    category: str | None
    tipologia: str | None
    titolo: str
    indirizzo: str | None
    comune: str | None
    provincia: str | None
    lat: float | None
    lon: float | None
    approx: bool
    prezzo_base: float | None
    offerta_minima: float | None
    data_vendita: datetime | None
    termine_offerte: datetime | None
    modalita: str | None
    occupazione: str | None
    superficie_mq: float | None
    n_rounds: int
    ribasso_pct: float | None
    status: str
    first_seen: datetime
    cover_url: str | None
    has_detail: bool


class LottiPage(BaseModel):
    items: list[LottoListItem]
    total: int
    page: int
    page_size: int


class AllegatoOut(BaseModel):
    id: int
    tipo: str
    descrizione: str | None
    filename: str | None
    url: str
    size: int | None
    image_url: str | None = None  # photo passthrough (relative to the API) when it is a listing photo


class VenditaOut(BaseModel):
    id: int
    pvp_id: int
    round_number: int | None
    data_vendita: datetime | None
    termine_offerte: datetime | None
    prezzo_base: float | None
    offerta_minima: float | None
    rialzo_minimo: float | None
    modalita: str | None
    tipo_vendita: str | None
    esito: str | None
    esito_desc: str | None
    data_pubblicazione: date | None
    drop_pct: float | None
    pvp_url: str
    is_current: bool
    has_detail: bool


class EventoOut(BaseModel):
    id: int
    tipo: str
    vendita_id: int | None
    old: dict[str, Any] | None
    new: dict[str, Any] | None
    at: datetime


class NotaIn(BaseModel):
    text: str = Field(min_length=1, max_length=10_000)


class NotaOut(BaseModel):
    id: int
    text: str
    created_at: datetime
    user_name: str | None
    user_id: int | None


class ClienteIn(BaseModel):
    display_name: str = Field(min_length=1, max_length=200)
    notes: str | None = None


class ClienteLinkOut(BaseModel):
    id: int
    cliente_id: int
    cliente_name: str
    status: str
    updated_at: datetime


class LottoClienteIn(BaseModel):
    cliente_id: int
    status: Literal["in_valutazione", "offerta_presentata", "aggiudicato", "scartato"] = "in_valutazione"


class LottoClienteUpdate(BaseModel):
    status: Literal["in_valutazione", "offerta_presentata", "aggiudicato", "scartato"]


class ContattoOut(BaseModel):
    role: str
    name: str | None
    email: str | None
    phone: str | None


class ShareLinkOut(BaseModel):
    id: int
    token: str
    url: str
    expires_at: datetime | None
    revoked: bool
    created_at: datetime


class LottoDetail(LottoListItem):
    rge_numero: str | None
    rge_anno: int | None
    tipo_procedura: str | None
    tribunale_name: str
    descrizione: str | None
    regione: str | None
    cap: str | None
    vani: float | None
    piano: str | None
    dati_catastali: list[dict[str, Any]] | None
    valore_stima: float | None
    sconto_stima_pct: float | None
    prezzo_mq: float | None
    rialzo_minimo: float | None
    tipo_vendita: str | None
    deposito_cauzionale: str | None
    prezzo_primo_esperimento: float | None
    geocode_source: str | None
    categorie_bene: list[str] | None
    pvp_url: str | None
    siti_pubblicita: list[dict[str, Any]]
    rounds: list[VenditaOut]
    allegati: list[AllegatoOut]
    eventi: list[EventoOut]
    note: list[NotaOut]
    clienti: list[ClienteLinkOut]
    contatti: list[ContattoOut]
    share_links: list[ShareLinkOut]
    detail_fetched_at: datetime | None


class PublicLotto(BaseModel):
    """Reduced read-only card for share links: no notes, clients or professional contacts."""

    titolo: str
    tribunale: str
    rge: str | None
    lotto_codice: str | None
    tipologia: str | None
    category: str | None
    indirizzo: str | None
    comune: str | None
    provincia: str | None
    lat: float | None
    lon: float | None
    approx: bool
    descrizione: str | None
    superficie_mq: float | None
    vani: float | None
    piano: str | None
    occupazione: str | None
    prezzo_base: float | None
    offerta_minima: float | None
    rialzo_minimo: float | None
    valore_stima: float | None
    sconto_stima_pct: float | None
    ribasso_pct: float | None
    prezzo_primo_esperimento: float | None
    prezzo_mq: float | None
    data_vendita: datetime | None
    termine_offerte: datetime | None
    modalita: str | None
    deposito_cauzionale: str | None
    status: str
    cover_url: str | None
    rounds: list[VenditaOut]
    allegati: list[AllegatoOut]
    pvp_url: str | None
    expires_at: datetime | None


class SavedSearchIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    criteria: LottoFilters
    alert_enabled: bool = False


class SavedSearchOut(BaseModel):
    id: int
    name: str
    criteria: dict[str, Any]
    alert_enabled: bool
    created_at: datetime
    match_count: int | None = None
    new_last_7d: int | None = None


class ClienteOut(BaseModel):
    id: int
    display_name: str
    notes: str | None
    created_at: datetime
    lotti: list[dict[str, Any]]


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    is_admin: bool


class IngestRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: str
    scope: str | None
    status: str
    started_at: datetime
    finished_at: datetime | None
    counts: dict[str, Any] | None
    errors: list[str] | None
