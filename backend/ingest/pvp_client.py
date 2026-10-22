"""A polite client for the (undocumented) PVP JSON API. See docs/pvp-api.md.

- at most one request per `pvp_min_interval_s` (default 1 s)
- exponential backoff on 429 / 5xx / network errors
- descriptive User-Agent
- microservice base paths are resolved at runtime from `bo-ms/fe-config/pvp`,
  because PVP embeds a deploy hash in them (e.g. `ric-496b258c-986a1b71/ric-ms`)
"""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import Settings, get_settings

log = logging.getLogger("ingest.pvp")

# Last known values (October 2026). Used only if fe-config cannot be read.
DEFAULT_MS = {
    "ricerca": "ric-496b258c-986a1b71/ric-ms",
    "vendite": "ve-3f723b85-986a1b71/ve-ms",
    "backoffice": "bo-5897bc47-986a1b71/bo-ms",
}
DEFAULT_BUCKETS_HOST = "https://resource-pvp.giustizia.it"
FE_CONFIG_PATH = "bo-5897bc47-986a1b71/bo-ms/fe-config/pvp"


class PvpError(RuntimeError):
    pass


class SchemaDriftError(PvpError):
    """Raised when an expected field disappears from a PVP payload."""


@dataclass
class PvpEndpoints:
    ricerca: str
    vendite: str
    backoffice: str
    buckets_host: str


class PvpClient:
    def __init__(self, settings: Settings | None = None, transport: httpx.BaseTransport | None = None):
        self.settings = settings or get_settings()
        self.http = httpx.Client(
            timeout=httpx.Timeout(60.0, connect=15.0),
            headers={"User-Agent": self.settings.pvp_user_agent, "Accept": "application/json"},
            transport=transport,
        )
        self._last_request = 0.0
        self._endpoints: PvpEndpoints | None = None
        self.request_count = 0

    # ------------------------------------------------------------------ plumbing

    def _throttle(self) -> None:
        wait = self.settings.pvp_min_interval_s - (time.monotonic() - self._last_request)
        if wait > 0:
            time.sleep(wait)
        self._last_request = time.monotonic()

    def _request(self, method: str, url: str, **kw: Any) -> Any:
        delay = 2.0
        for _attempt in range(6):
            self._throttle()
            self.request_count += 1
            try:
                r = self.http.request(method, url, **kw)
            except httpx.TransportError as e:
                log.warning("PVP %s %s network error (%s), retry in %.0fs", method, url, e, delay)
            else:
                if r.status_code == 429 or r.status_code >= 500:
                    retry_after = r.headers.get("Retry-After")
                    wait = float(retry_after) if retry_after and retry_after.isdigit() else delay
                    log.warning("PVP %s %s -> %s, retry in %.0fs", method, url, r.status_code, wait)
                    time.sleep(wait)
                    delay = min(delay * 2, 120)
                    continue
                if r.status_code >= 400:
                    raise PvpError(f"PVP {method} {url} -> HTTP {r.status_code}: {r.text[:300]}")
                try:
                    return r.json()
                except ValueError as e:
                    raise PvpError(f"PVP {method} {url}: response is not JSON") from e
            time.sleep(delay)
            delay = min(delay * 2, 120)
        raise PvpError(f"PVP {method} {url}: giving up after retries")

    @staticmethod
    def _body(payload: Any, url: str) -> Any:
        if not isinstance(payload, dict) or "body" not in payload:
            raise SchemaDriftError(f"{url}: expected an envelope with 'body', got {str(payload)[:200]}")
        if payload.get("error"):
            raise PvpError(f"{url}: PVP error {payload['error']}")
        return payload["body"]

    # ------------------------------------------------------------------ endpoints

    @property
    def endpoints(self) -> PvpEndpoints:
        if self._endpoints is None:
            self._endpoints = self._resolve_endpoints()
        return self._endpoints

    def _resolve_endpoints(self) -> PvpEndpoints:
        host = self.settings.pvp_host.rstrip("/")
        ms = dict(DEFAULT_MS)
        buckets = DEFAULT_BUCKETS_HOST
        try:
            cfg = self._request("GET", f"{host}/{FE_CONFIG_PATH}")
            ms.update({k: v for k, v in (cfg.get("msUrl") or {}).items() if k in ms and v})
            buckets = cfg.get("bucketsHost") or buckets
            host = (cfg.get("host") or host).rstrip("/")
        except PvpError as e:
            log.warning("Could not read PVP fe-config, using last known base paths: %s", e)
        return PvpEndpoints(
            ricerca=f"{host}/{ms['ricerca']}",
            vendite=f"{host}/{ms['vendite']}",
            backoffice=f"{host}/{ms['backoffice']}",
            buckets_host=buckets.rstrip("/"),
        )

    def search_page(
        self, filters: dict[str, Any], page: int, size: int, sort: list[str] | None = None
    ) -> dict[str, Any]:
        url = f"{self.endpoints.ricerca}/ricerca/vendite"
        params: list[tuple[str, str | int]] = [("language", "it"), ("page", page), ("size", size)]
        for s in sort or ["dataOraVendita,desc"]:
            params.append(("sort", s))
        body = self._body(self._request("POST", url, params=params, json=filters), url)
        for key in ("content", "totalElements", "last"):
            if key not in body:
                raise SchemaDriftError(f"search response lost field '{key}'")
        return body  # type: ignore[no-any-return]

    def iter_upcoming(self, filters: dict[str, Any], today_iso: str) -> Iterator[dict[str, Any]]:
        """All sales with dataVendita >= today. PVP has no 'upcoming' filter (filtroAnnunci=1
        only covers ~60 days), so we sort by sale date descending and stop at the first past one."""
        return self.iter_since(filters, today_iso)

    def iter_since(self, filters: dict[str, Any], since_iso: str, max_pages: int = 2000) -> Iterator[dict[str, Any]]:
        """Every sale with dataVendita >= since_iso, newest first (also used for the history backfill)."""
        for page in range(max_pages):
            body = self.search_page(filters, page, self.settings.pvp_page_size)
            for item in body["content"]:
                if (item.get("dataVendita") or "") < since_iso:
                    return
                yield item
            if body["last"] or not body["content"]:
                return

    def iter_all(self, filters: dict[str, Any], max_pages: int = 10) -> Iterator[dict[str, Any]]:
        """Every sale matching the filters, past ones included (used for round history)."""
        for page in range(max_pages):
            body = self.search_page(filters, page, self.settings.pvp_page_size)
            yield from body["content"]
            if body["last"]:
                return

    def vendita_detail(self, pvp_id: int) -> dict[str, Any]:
        url = f"{self.endpoints.vendite}/vendite/{pvp_id}/restricted"
        body = self._body(self._request("GET", url, params={"language": "it"}), url)
        if not isinstance(body, dict):
            raise PvpError(f"vendita {pvp_id}: empty detail")
        for key in ("idVendita", "lotto", "procedura", "impoBaseAsta"):
            if key not in body:
                raise SchemaDriftError(f"detail response lost field '{key}'")
        return body

    def vendite_precedenti(self, pvp_lotto_id: int) -> list[dict[str, Any]]:
        url = f"{self.endpoints.vendite}/vendite/lotti/{pvp_lotto_id}/vendite-precedenti"
        return self._body(self._request("GET", url, params={"language": "it"}), url) or []

    def tribunali(self) -> list[dict[str, Any]]:
        url = f"{self.endpoints.vendite}/tribunali"
        return self._body(self._request("GET", url), url) or []

    def attachment_url(self, path: str) -> str:
        return f"{self.endpoints.buckets_host}{path if path.startswith('/') else '/' + path}"

    def close(self) -> None:
        self.http.close()
