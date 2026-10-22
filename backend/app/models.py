"""SQLAlchemy models. See docs/data-model.md for the rationale behind each table."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from geoalchemy2 import Geography
from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

TS = DateTime(timezone=True)


class Tribunale(Base):
    __tablename__ = "tribunali"

    id: Mapped[int] = mapped_column(primary_key=True)
    pvp_code: Mapped[str] = mapped_column(String(16), unique=True)
    # Exact PVP label, e.g. "Tribunale di PADOVA". PVP filters search by this label, not by code.
    name: Mapped[str] = mapped_column(String(200))
    short_name: Mapped[str] = mapped_column(String(120))
    region: Mapped[str | None] = mapped_column(String(60))
    active_for_enrichment: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class Lotto(Base):
    """The persistent property, across auction rounds."""

    __tablename__ = "lotti"

    id: Mapped[int] = mapped_column(primary_key=True)
    lot_key: Mapped[str] = mapped_column(String(200), unique=True)
    key_is_provisional: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    tribunale_id: Mapped[int] = mapped_column(ForeignKey("tribunali.id"))
    rge_numero: Mapped[str | None] = mapped_column(String(60))
    rge_anno: Mapped[int | None] = mapped_column(Integer)
    lotto_codice: Mapped[str | None] = mapped_column(String(60))

    tipo_lotto: Mapped[str | None] = mapped_column(String(40))
    category: Mapped[str | None] = mapped_column(String(60))
    subtype: Mapped[str | None] = mapped_column(String(60))
    categorie_bene: Mapped[list[str] | None] = mapped_column(ARRAY(String(60)))

    indirizzo: Mapped[str | None] = mapped_column(Text)
    comune: Mapped[str | None] = mapped_column(String(120))
    provincia: Mapped[str | None] = mapped_column(String(80))
    provincia_sigla: Mapped[str | None] = mapped_column(String(4))
    regione: Mapped[str | None] = mapped_column(String(60))
    cap: Mapped[str | None] = mapped_column(String(10))
    geom: Mapped[Any] = mapped_column(Geography("POINT", srid=4326, spatial_index=False), nullable=True)
    geocode_source: Mapped[str | None] = mapped_column(String(20))  # pvp | nominatim | comune
    geocode_confidence: Mapped[float | None] = mapped_column(Float)

    superficie_mq: Mapped[float | None] = mapped_column(Float)
    vani: Mapped[float | None] = mapped_column(Float)
    piano: Mapped[str | None] = mapped_column(String(40))
    descrizione: Mapped[str | None] = mapped_column(Text)
    dati_catastali: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    occupazione: Mapped[str | None] = mapped_column(String(20))
    tipo_procedura: Mapped[str | None] = mapped_column(String(120))

    # Denormalised snapshot of the current (latest) round, for fast filtering and the map.
    current_vendita_id: Mapped[int | None] = mapped_column(
        ForeignKey("vendite.id", use_alter=True, name="fk_lotti_current_vendita")
    )
    prezzo_base: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    offerta_minima: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    data_vendita: Mapped[datetime | None] = mapped_column(TS)
    termine_offerte: Mapped[datetime | None] = mapped_column(TS)
    modalita: Mapped[str | None] = mapped_column(String(20))
    valore_stima: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    prezzo_primo_esperimento: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    n_rounds: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    last_price_drop_at: Mapped[datetime | None] = mapped_column(TS)
    has_detail: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    cover_image_path: Mapped[str | None] = mapped_column(Text)

    # market analysis (filled by ingest.analytics; see docs/market-analysis.md)
    segment: Mapped[str | None] = mapped_column(String(20))
    superficie_source: Mapped[str | None] = mapped_column(String(10))  # pvp | testo
    quota_parziale: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    eur_mq: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    eur_mq_stima: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    zona_level: Mapped[str | None] = mapped_column(String(10))  # hex | comune | provincia
    zona_key: Mapped[str | None] = mapped_column(String(160))
    zona_label: Mapped[str | None] = mapped_column(String(160))
    zona_n: Mapped[int | None] = mapped_column(Integer)
    zona_eur_mq: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    zona_p25: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    zona_p75: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    sconto_zona_pct: Mapped[float | None] = mapped_column(Float)  # vs the zone's appraised €/m²
    zona_asta_eur_mq: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))  # typical auction €/m² in the zone
    sconto_aste_pct: Mapped[float | None] = mapped_column(Float)  # vs the zone's auction €/m²
    opportunity: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    opportunity_since: Mapped[datetime | None] = mapped_column(TS)

    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active")
    missed_runs: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    merged_into_id: Mapped[int | None] = mapped_column(ForeignKey("lotti.id"))
    history_synced_at: Mapped[datetime | None] = mapped_column(TS)
    first_seen: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    last_seen: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=func.now(), onupdate=func.now())

    tribunale: Mapped[Tribunale] = relationship(lazy="joined")
    vendite: Mapped[list[Vendita]] = relationship(
        back_populates="lotto", foreign_keys="Vendita.lotto_id", order_by="Vendita.data_vendita"
    )

    __table_args__ = (
        Index("ix_lotti_geom", "geom", postgresql_using="gist"),
        Index("ix_lotti_tribunale", "tribunale_id"),
        Index("ix_lotti_prezzo_base", "prezzo_base"),
        Index("ix_lotti_termine_offerte", "termine_offerte"),
        Index("ix_lotti_data_vendita", "data_vendita"),
        Index("ix_lotti_status", "status"),
        Index("ix_lotti_category", "category"),
        Index("ix_lotti_comune", "comune"),
        Index("ix_lotti_first_seen", "first_seen"),
        Index("ix_lotti_opportunity", "opportunity"),
        Index("ix_lotti_segment", "segment"),
    )


class Vendita(Base):
    """One auction round (esperimento di vendita). PVP gives each round a new id."""

    __tablename__ = "vendite"

    id: Mapped[int] = mapped_column(primary_key=True)
    pvp_id: Mapped[int] = mapped_column(BigInteger, unique=True)
    pvp_lotto_id: Mapped[int | None] = mapped_column(BigInteger)
    lotto_id: Mapped[int] = mapped_column(ForeignKey("lotti.id"))
    data_vendita: Mapped[datetime | None] = mapped_column(TS)
    termine_offerte: Mapped[datetime | None] = mapped_column(TS)
    prezzo_base: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    offerta_minima: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    rialzo_minimo: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    modalita: Mapped[str | None] = mapped_column(String(20))  # VENDTEL | VENDMIS | VENDAS | VENDPDO
    tipo_vendita: Mapped[str | None] = mapped_column(String(20))  # SENIN | CONIN | COMPE ...
    valore_stima: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    round_number: Mapped[int | None] = mapped_column(Integer)
    stato_pvp: Mapped[str | None] = mapped_column(String(4))  # P published, C concluded
    esito: Mapped[str | None] = mapped_column(String(10))  # AGGIU | ASDES
    esito_desc: Mapped[str | None] = mapped_column(Text)
    data_conclusione: Mapped[date | None] = mapped_column(Date)
    data_pubblicazione: Mapped[date | None] = mapped_column(Date)
    deposito_cauzionale: Mapped[str | None] = mapped_column(Text)
    siti_pubblicita: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    raw_list: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    raw: Mapped[dict[str, Any] | None] = mapped_column(JSONB)  # scrubbed detail payload
    list_hash: Mapped[str | None] = mapped_column(String(64))
    content_hash: Mapped[str | None] = mapped_column(String(64))
    detail_list_hash: Mapped[str | None] = mapped_column(String(64))  # list_hash at last detail fetch
    list_fetched_at: Mapped[datetime | None] = mapped_column(TS)
    fetched_at: Mapped[datetime | None] = mapped_column(TS)  # last detail fetch
    last_seen: Mapped[datetime | None] = mapped_column(TS)
    missed_runs: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())

    lotto: Mapped[Lotto] = relationship(back_populates="vendite", foreign_keys=[lotto_id])
    allegati: Mapped[list[Allegato]] = relationship(back_populates="vendita", cascade="all, delete-orphan")

    __table_args__ = (Index("ix_vendite_lotto", "lotto_id"), Index("ix_vendite_data", "data_vendita"))


class Allegato(Base):
    __tablename__ = "allegati"

    id: Mapped[int] = mapped_column(primary_key=True)
    vendita_id: Mapped[int] = mapped_column(ForeignKey("vendite.id", ondelete="CASCADE"))
    pvp_id: Mapped[int | None] = mapped_column(BigInteger)
    tipo: Mapped[str] = mapped_column(String(20))  # perizia | avviso | ordinanza | foto | planimetria | other
    pvp_tipo: Mapped[str | None] = mapped_column(String(10))
    descrizione: Mapped[str | None] = mapped_column(Text)
    filename: Mapped[str | None] = mapped_column(Text)
    path: Mapped[str] = mapped_column(Text)  # relative to PVP bucketsHost
    size: Mapped[int | None] = mapped_column(BigInteger)

    vendita: Mapped[Vendita] = relationship(back_populates="allegati")
    __table_args__ = (Index("ix_allegati_vendita", "vendita_id"),)


class ContattoProfessionale(Base):
    """Delegato / custode contacts. Written only when STORE_PROFESSIONAL_CONTACTS=true.
    Isolated in its own table so it can be truncated or dropped without touching anything else."""

    __tablename__ = "contatti_professionali"

    id: Mapped[int] = mapped_column(primary_key=True)
    vendita_id: Mapped[int] = mapped_column(ForeignKey("vendite.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(30))
    name: Mapped[str | None] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(60))


class Evento(Base):
    __tablename__ = "eventi"

    id: Mapped[int] = mapped_column(primary_key=True)
    lotto_id: Mapped[int] = mapped_column(ForeignKey("lotti.id"))
    vendita_id: Mapped[int | None] = mapped_column(ForeignKey("vendite.id"))
    run_id: Mapped[int | None] = mapped_column(ForeignKey("ingest_runs.id"))
    tipo: Mapped[str] = mapped_column(String(30))
    old: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    new: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    at: Mapped[datetime] = mapped_column(TS, server_default=func.now())

    __table_args__ = (
        Index("ix_eventi_lotto", "lotto_id"),
        Index("ix_eventi_run", "run_id"),
        Index("ix_eventi_at", "at"),
    )


class GeocodeCache(Base):
    __tablename__ = "geocode_cache"

    address: Mapped[str] = mapped_column(Text, primary_key=True)
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(20))
    confidence: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())


class IngestRun(Base):
    __tablename__ = "ingest_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(30))  # sync | geocode | detail | alerts
    scope: Mapped[str | None] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default="running")  # running | ok | failed
    started_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(TS)
    counts: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    errors: Mapped[list[str] | None] = mapped_column(JSONB)


# ---------------------------------------------------------------- market history


class StoricoVendita(Base):
    """One row per PVP sale (any date), slim: the raw material of the market analysis.
    Filled from search pages only (no details), nationally."""

    __tablename__ = "storico_vendite"

    pvp_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    trib_code: Mapped[str] = mapped_column(String(16))
    rge_numero: Mapped[str | None] = mapped_column(String(60))
    lotto_codice: Mapped[str | None] = mapped_column(String(60))
    comune: Mapped[str | None] = mapped_column(String(120))
    provincia: Mapped[str | None] = mapped_column(String(80))
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    category: Mapped[str | None] = mapped_column(String(60))
    subtype: Mapped[str | None] = mapped_column(String(60))
    segment: Mapped[str | None] = mapped_column(String(20))
    superficie: Mapped[float | None] = mapped_column(Float)
    quota_parziale: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    prezzo_base: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    data_vendita: Mapped[date | None] = mapped_column(Date)
    data_pubblicazione: Mapped[date | None] = mapped_column(Date)
    esito: Mapped[str | None] = mapped_column(String(10))
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_storico_data", "data_vendita"),
        Index("ix_storico_segment", "segment"),
        Index("ix_storico_lot", "trib_code", "rge_numero", "lotto_codice"),
    )


class AreaStat(Base):
    """Appraised €/m² per zone and segment (median of first-round prices per m²)."""

    __tablename__ = "area_stats"

    id: Mapped[int] = mapped_column(primary_key=True)
    segment: Mapped[str] = mapped_column(String(20))
    level: Mapped[str] = mapped_column(String(10))  # hex | comune | provincia | italia
    key: Mapped[str] = mapped_column(String(160))
    label: Mapped[str | None] = mapped_column(String(160))
    n: Mapped[int] = mapped_column(Integer)
    median: Mapped[float] = mapped_column(Float)
    p25: Mapped[float] = mapped_column(Float)
    p75: Mapped[float] = mapped_column(Float)
    asta_median: Mapped[float | None] = mapped_column(Float)  # current auction €/m² of active lots
    n_active: Mapped[int] = mapped_column(Integer, default=0)
    n_opportunities: Mapped[int] = mapped_column(Integer, default=0)
    trend_pct: Mapped[float | None] = mapped_column(Float)  # last 12 months vs the 12 before
    center_lon: Mapped[float | None] = mapped_column(Float)
    center_lat: Mapped[float | None] = mapped_column(Float)
    polygon: Mapped[list[Any] | None] = mapped_column(JSONB)
    computed_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("segment", "level", "key", name="uq_area_stat"),
        Index("ix_area_stats_center", "level", "segment", "center_lon", "center_lat"),
    )


class PriceIndex(Base):
    """Quarterly €/m²: appraisals (first rounds) and auction base prices (every round)."""

    __tablename__ = "price_index"

    id: Mapped[int] = mapped_column(primary_key=True)
    segment: Mapped[str] = mapped_column(String(20))
    level: Mapped[str] = mapped_column(String(10))  # italia | provincia
    key: Mapped[str] = mapped_column(String(120))
    quarter: Mapped[str] = mapped_column(String(7))  # 2024-Q3
    period_start: Mapped[date] = mapped_column(Date)
    n_stime: Mapped[int] = mapped_column(Integer)
    stima_eur_mq: Mapped[float | None] = mapped_column(Float)
    n_aste: Mapped[int] = mapped_column(Integer)
    asta_eur_mq: Mapped[float | None] = mapped_column(Float)
    n_deserte: Mapped[int] = mapped_column(Integer, default=0)
    # PVP published (almost) nothing this quarter: values are null on purpose, see pvp-api.md
    gap: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    __table_args__ = (UniqueConstraint("segment", "level", "key", "quarter", name="uq_price_index"),)


# ---------------------------------------------------------------- app tables


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(200), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(300))
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())


class SavedSearch(Base):
    __tablename__ = "saved_searches"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    criteria: Mapped[dict[str, Any]] = mapped_column(JSONB)
    polygon: Mapped[dict[str, Any] | None] = mapped_column(JSONB)  # GeoJSON Polygon
    alert_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=func.now(), onupdate=func.now())


class AlertLog(Base):
    __tablename__ = "alert_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    saved_search_id: Mapped[int | None] = mapped_column(ForeignKey("saved_searches.id", ondelete="SET NULL"))
    evento_id: Mapped[int] = mapped_column(ForeignKey("eventi.id", ondelete="CASCADE"))
    sent_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    email_id: Mapped[str | None] = mapped_column(String(100))

    __table_args__ = (UniqueConstraint("user_id", "evento_id", name="uq_alert_user_evento"),)


class Cliente(Base):
    __tablename__ = "clienti"

    id: Mapped[int] = mapped_column(primary_key=True)
    display_name: Mapped[str] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())

    links: Mapped[list[LottoCliente]] = relationship(back_populates="cliente", cascade="all, delete-orphan")


class LottoCliente(Base):
    __tablename__ = "lotto_cliente"

    id: Mapped[int] = mapped_column(primary_key=True)
    lotto_id: Mapped[int] = mapped_column(ForeignKey("lotti.id", ondelete="CASCADE"), index=True)
    cliente_id: Mapped[int] = mapped_column(ForeignKey("clienti.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="in_valutazione")
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=func.now(), onupdate=func.now())

    cliente: Mapped[Cliente] = relationship(back_populates="links")
    lotto: Mapped[Lotto] = relationship()
    __table_args__ = (UniqueConstraint("lotto_id", "cliente_id", name="uq_lotto_cliente"),)


class Nota(Base):
    __tablename__ = "note"

    id: Mapped[int] = mapped_column(primary_key=True)
    lotto_id: Mapped[int] = mapped_column(ForeignKey("lotti.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())

    user: Mapped[User | None] = relationship()


class ShareLink(Base):
    __tablename__ = "share_links"

    id: Mapped[int] = mapped_column(primary_key=True)
    token: Mapped[str] = mapped_column(String(64), unique=True)
    lotto_id: Mapped[int] = mapped_column(ForeignKey("lotti.id", ondelete="CASCADE"), index=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    expires_at: Mapped[datetime | None] = mapped_column(TS)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
