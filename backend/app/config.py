from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+psycopg://postgres@localhost:5432/aste"

    # Auth
    jwt_secret: str = "change-me-in-production"
    jwt_ttl_hours: int = 24 * 14
    cookie_name: str = "le_session"
    cookie_secure: bool = False
    # "lax" when the frontend and the API share an origin (production: app.server serves both),
    # "none" only if they ever live on different sites.
    cookie_samesite: str = "lax"
    cors_origins: str = "http://localhost:5173"

    # Built React app (frontend/dist) served by app.server at /. Set in the Docker image.
    frontend_dir: str = ""

    # A brand-new deployment loads PVP by itself at startup: national sync, then the market history.
    first_load_on_start: bool = True

    # First admin, created at startup only while there are no users at all (no terminal needed).
    # Remove ADMIN_PASSWORD once you have logged in; everyone else is invited from the Admin page.
    admin_email: str = ""
    admin_name: str = "Amministratore"
    admin_password: str = ""

    # GDPR: delegato/custode names and contacts are only stored when this is on.
    store_professional_contacts: bool = False

    # PVP client
    pvp_host: str = "https://pvp.giustizia.it"
    pvp_user_agent: str = (
        "LegalEstate-AsteInternal/1.0 (+https://www.legalestateitalia.it; internal tool, nightly sync)"
    )
    pvp_min_interval_s: float = 1.0
    pvp_page_size: int = 500
    pvp_buckets_host: str = "https://resource-pvp.giustizia.it"
    pvp_public_url: str = "https://pvp.giustizia.it/pvp/it/detail_annuncio.page?idAnnuncio="
    unseen_runs_before_unknown: int = 3
    outcome_check_limit: int = 200

    # Geocoding
    nominatim_url: str = "https://nominatim.openstreetmap.org/search"
    nominatim_email: str = ""
    geocode_limit: int = 800

    # Market analysis (see docs/market-analysis.md)
    hex_size_m: float = 1200.0  # zone hexagon, centre to corner (≈ 2 km across)
    analytics_years: int = 6  # appraisals older than this are not used for zone values
    # opportunity = current €/m² at least X% below the zone's appraised value AND at least Y% below
    # what auctions in the same zone typically ask (calibrated on the live data, docs/market-analysis.md)
    opportunity_threshold_pct: float = 35.0
    opportunity_auction_pct: float = 25.0

    # Email (Resend). Without a key, emails are logged instead of sent.
    resend_api_key: str = ""
    email_from: str = "Legal Estate Aste <aste@legalestateitalia.it>"
    public_app_url: str = "http://localhost:5173"

    # Public share links
    share_link_days: int = 30
    public_rate_limit_per_min: int = 30

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
