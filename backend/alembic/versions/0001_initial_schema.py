"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-10-22 17:28:31.960952
"""

from alembic import op
import sqlalchemy as sa
import geoalchemy2
from geoalchemy2 import Geography
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.create_table(
        "clienti",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "geocode_cache",
        sa.Column("address", sa.Text(), nullable=False),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lon", sa.Float(), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("address"),
    )
    op.create_table(
        "ingest_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=30), nullable=False),
        sa.Column("scope", sa.String(length=20), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("counts", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("errors", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "tribunali",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("pvp_code", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("short_name", sa.String(length=120), nullable=False),
        sa.Column("region", sa.String(length=60), nullable=True),
        sa.Column("active_for_enrichment", sa.Boolean(), server_default="false", nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("pvp_code"),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=200), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("password_hash", sa.String(length=300), nullable=False),
        sa.Column("is_admin", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_geospatial_table(
        "lotti",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("lot_key", sa.String(length=200), nullable=False),
        sa.Column("key_is_provisional", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("tribunale_id", sa.Integer(), nullable=False),
        sa.Column("rge_numero", sa.String(length=20), nullable=True),
        sa.Column("rge_anno", sa.Integer(), nullable=True),
        sa.Column("lotto_codice", sa.String(length=60), nullable=True),
        sa.Column("tipo_lotto", sa.String(length=40), nullable=True),
        sa.Column("category", sa.String(length=60), nullable=True),
        sa.Column("subtype", sa.String(length=60), nullable=True),
        sa.Column("categorie_bene", postgresql.ARRAY(sa.String(length=60)), nullable=True),
        sa.Column("indirizzo", sa.Text(), nullable=True),
        sa.Column("comune", sa.String(length=120), nullable=True),
        sa.Column("provincia", sa.String(length=80), nullable=True),
        sa.Column("provincia_sigla", sa.String(length=4), nullable=True),
        sa.Column("regione", sa.String(length=60), nullable=True),
        sa.Column("cap", sa.String(length=10), nullable=True),
        sa.Column(
            "geom",
            Geography(
                geometry_type="POINT",
                srid=4326,
                dimension=2,
                spatial_index=False,
                from_text="ST_GeogFromText",
                name="geography",
            ),
            nullable=True,
        ),
        sa.Column("geocode_source", sa.String(length=20), nullable=True),
        sa.Column("geocode_confidence", sa.Float(), nullable=True),
        sa.Column("superficie_mq", sa.Float(), nullable=True),
        sa.Column("vani", sa.Float(), nullable=True),
        sa.Column("piano", sa.String(length=40), nullable=True),
        sa.Column("descrizione", sa.Text(), nullable=True),
        sa.Column("dati_catastali", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("occupazione", sa.String(length=20), nullable=True),
        sa.Column("tipo_procedura", sa.String(length=120), nullable=True),
        sa.Column("current_vendita_id", sa.Integer(), nullable=True),
        sa.Column("prezzo_base", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("offerta_minima", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("data_vendita", sa.DateTime(timezone=True), nullable=True),
        sa.Column("termine_offerte", sa.DateTime(timezone=True), nullable=True),
        sa.Column("modalita", sa.String(length=20), nullable=True),
        sa.Column("valore_stima", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("prezzo_primo_esperimento", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("n_rounds", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_price_drop_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("has_detail", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("cover_image_path", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="active", nullable=False),
        sa.Column("missed_runs", sa.Integer(), server_default="0", nullable=False),
        sa.Column("merged_into_id", sa.Integer(), nullable=True),
        sa.Column("history_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("first_seen", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["merged_into_id"],
            ["lotti.id"],
        ),
        sa.ForeignKeyConstraint(
            ["tribunale_id"],
            ["tribunali.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("lot_key"),
    )
    op.create_index("ix_lotti_category", "lotti", ["category"], unique=False)
    op.create_index("ix_lotti_comune", "lotti", ["comune"], unique=False)
    op.create_index("ix_lotti_data_vendita", "lotti", ["data_vendita"], unique=False)
    op.create_index("ix_lotti_first_seen", "lotti", ["first_seen"], unique=False)
    op.create_geospatial_index(
        "ix_lotti_geom", "lotti", ["geom"], unique=False, postgresql_using="gist", postgresql_ops={}
    )
    op.create_index("ix_lotti_prezzo_base", "lotti", ["prezzo_base"], unique=False)
    op.create_index("ix_lotti_status", "lotti", ["status"], unique=False)
    op.create_index("ix_lotti_termine_offerte", "lotti", ["termine_offerte"], unique=False)
    op.create_index("ix_lotti_tribunale", "lotti", ["tribunale_id"], unique=False)
    op.create_table(
        "saved_searches",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("criteria", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("polygon", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("alert_enabled", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_saved_searches_user_id"), "saved_searches", ["user_id"], unique=False)
    op.create_table(
        "lotto_cliente",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("lotto_id", sa.Integer(), nullable=False),
        sa.Column("cliente_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["cliente_id"], ["clienti.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["lotto_id"], ["lotti.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("lotto_id", "cliente_id", name="uq_lotto_cliente"),
    )
    op.create_index(op.f("ix_lotto_cliente_cliente_id"), "lotto_cliente", ["cliente_id"], unique=False)
    op.create_index(op.f("ix_lotto_cliente_lotto_id"), "lotto_cliente", ["lotto_id"], unique=False)
    op.create_table(
        "note",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("lotto_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["lotto_id"], ["lotti.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_note_lotto_id"), "note", ["lotto_id"], unique=False)
    op.create_table(
        "share_links",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("lotto_id", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["lotto_id"], ["lotti.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token"),
    )
    op.create_index(op.f("ix_share_links_lotto_id"), "share_links", ["lotto_id"], unique=False)
    op.create_table(
        "vendite",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("pvp_id", sa.BigInteger(), nullable=False),
        sa.Column("pvp_lotto_id", sa.BigInteger(), nullable=True),
        sa.Column("lotto_id", sa.Integer(), nullable=False),
        sa.Column("data_vendita", sa.DateTime(timezone=True), nullable=True),
        sa.Column("termine_offerte", sa.DateTime(timezone=True), nullable=True),
        sa.Column("prezzo_base", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("offerta_minima", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("rialzo_minimo", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("modalita", sa.String(length=20), nullable=True),
        sa.Column("tipo_vendita", sa.String(length=20), nullable=True),
        sa.Column("valore_stima", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("round_number", sa.Integer(), nullable=True),
        sa.Column("stato_pvp", sa.String(length=4), nullable=True),
        sa.Column("esito", sa.String(length=10), nullable=True),
        sa.Column("esito_desc", sa.Text(), nullable=True),
        sa.Column("data_conclusione", sa.Date(), nullable=True),
        sa.Column("data_pubblicazione", sa.Date(), nullable=True),
        sa.Column("deposito_cauzionale", sa.Text(), nullable=True),
        sa.Column("siti_pubblicita", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("raw_list", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("raw", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("list_hash", sa.String(length=64), nullable=True),
        sa.Column("content_hash", sa.String(length=64), nullable=True),
        sa.Column("detail_list_hash", sa.String(length=64), nullable=True),
        sa.Column("list_fetched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=True),
        sa.Column("missed_runs", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["lotto_id"],
            ["lotti.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("pvp_id"),
    )
    op.create_index("ix_vendite_data", "vendite", ["data_vendita"], unique=False)
    op.create_index("ix_vendite_lotto", "vendite", ["lotto_id"], unique=False)
    op.create_table(
        "allegati",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("vendita_id", sa.Integer(), nullable=False),
        sa.Column("pvp_id", sa.BigInteger(), nullable=True),
        sa.Column("tipo", sa.String(length=20), nullable=False),
        sa.Column("pvp_tipo", sa.String(length=10), nullable=True),
        sa.Column("descrizione", sa.Text(), nullable=True),
        sa.Column("filename", sa.Text(), nullable=True),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["vendita_id"], ["vendite.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_allegati_vendita", "allegati", ["vendita_id"], unique=False)
    op.create_table(
        "contatti_professionali",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("vendita_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=30), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=True),
        sa.Column("email", sa.String(length=200), nullable=True),
        sa.Column("phone", sa.String(length=60), nullable=True),
        sa.ForeignKeyConstraint(["vendita_id"], ["vendite.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_contatti_professionali_vendita_id"), "contatti_professionali", ["vendita_id"], unique=False
    )
    op.create_table(
        "eventi",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("lotto_id", sa.Integer(), nullable=False),
        sa.Column("vendita_id", sa.Integer(), nullable=True),
        sa.Column("run_id", sa.Integer(), nullable=True),
        sa.Column("tipo", sa.String(length=30), nullable=False),
        sa.Column("old", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("new", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["lotto_id"],
            ["lotti.id"],
        ),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["ingest_runs.id"],
        ),
        sa.ForeignKeyConstraint(
            ["vendita_id"],
            ["vendite.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_eventi_at", "eventi", ["at"], unique=False)
    op.create_index("ix_eventi_lotto", "eventi", ["lotto_id"], unique=False)
    op.create_index("ix_eventi_run", "eventi", ["run_id"], unique=False)
    op.create_table(
        "alert_log",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("saved_search_id", sa.Integer(), nullable=True),
        sa.Column("evento_id", sa.Integer(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("email_id", sa.String(length=100), nullable=True),
        sa.ForeignKeyConstraint(["evento_id"], ["eventi.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["saved_search_id"], ["saved_searches.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "evento_id", name="uq_alert_user_evento"),
    )
    op.create_foreign_key("fk_lotti_current_vendita", "lotti", "vendite", ["current_vendita_id"], ["id"])


def downgrade() -> None:
    op.drop_constraint("fk_lotti_current_vendita", "lotti", type_="foreignkey")
    op.drop_table("alert_log")
    op.drop_index("ix_eventi_run", table_name="eventi")
    op.drop_index("ix_eventi_lotto", table_name="eventi")
    op.drop_index("ix_eventi_at", table_name="eventi")
    op.drop_table("eventi")
    op.drop_index(op.f("ix_contatti_professionali_vendita_id"), table_name="contatti_professionali")
    op.drop_table("contatti_professionali")
    op.drop_index("ix_allegati_vendita", table_name="allegati")
    op.drop_table("allegati")
    op.drop_index("ix_vendite_lotto", table_name="vendite")
    op.drop_index("ix_vendite_data", table_name="vendite")
    op.drop_table("vendite")
    op.drop_index(op.f("ix_share_links_lotto_id"), table_name="share_links")
    op.drop_table("share_links")
    op.drop_index(op.f("ix_note_lotto_id"), table_name="note")
    op.drop_table("note")
    op.drop_index(op.f("ix_lotto_cliente_lotto_id"), table_name="lotto_cliente")
    op.drop_index(op.f("ix_lotto_cliente_cliente_id"), table_name="lotto_cliente")
    op.drop_table("lotto_cliente")
    op.drop_index(op.f("ix_saved_searches_user_id"), table_name="saved_searches")
    op.drop_table("saved_searches")
    op.drop_index("ix_lotti_tribunale", table_name="lotti")
    op.drop_index("ix_lotti_termine_offerte", table_name="lotti")
    op.drop_index("ix_lotti_status", table_name="lotti")
    op.drop_index("ix_lotti_prezzo_base", table_name="lotti")
    op.drop_geospatial_index("ix_lotti_geom", table_name="lotti", postgresql_using="gist", column_name="geom")
    op.drop_index("ix_lotti_first_seen", table_name="lotti")
    op.drop_index("ix_lotti_data_vendita", table_name="lotti")
    op.drop_index("ix_lotti_comune", table_name="lotti")
    op.drop_index("ix_lotti_category", table_name="lotti")
    op.drop_geospatial_table("lotti")
    op.drop_table("users")
    op.drop_table("tribunali")
    op.drop_table("ingest_runs")
    op.drop_table("geocode_cache")
    op.drop_table("clienti")
