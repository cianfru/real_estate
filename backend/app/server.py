"""Production entry point: one container serves the React app at / and the API at /api.

Same origin, so the session cookie stays first-party (SameSite=Lax) and nothing has to proxy the
API. Development keeps `app.main:app` (API at the root) behind Vite's /api proxy.

    FRONTEND_DIR=../frontend/dist uvicorn app.server:site
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response
from starlette.staticfiles import StaticFiles

from app.config import get_settings
from app.main import app as api
from app.main import health

SECURITY_HEADERS = {
    "X-Robots-Tag": "noindex, nofollow",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
}


class _HashedAssets(StaticFiles):
    """Vite puts a content hash in every asset name, so they can be cached forever."""

    def file_response(self, *args: Any, **kwargs: Any) -> Response:
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


def create_site(dist: Path | None) -> FastAPI:
    site = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    site.add_middleware(GZipMiddleware, minimum_size=1024)

    @site.middleware("http")
    async def security_headers(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        response = await call_next(request)
        for key, value in SECURITY_HEADERS.items():
            response.headers.setdefault(key, value)
        return response

    site.add_api_route("/health", health, methods=["GET"], include_in_schema=False)
    site.mount("/api", api)

    if dist is None or not (dist / "index.html").is_file():
        return site  # API only (e.g. the nightly job's container, or a build without the frontend)
    root = dist.resolve()
    index = root / "index.html"
    if (root / "assets").is_dir():
        site.mount("/assets", _HashedAssets(directory=root / "assets"), name="assets")

    @site.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> Response:
        """Files from the build (favicon, robots.txt), otherwise the app shell: the React router
        handles /mercato, /lotti/123, /s/<token> and the rest."""
        candidate = (root / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(root):
            return FileResponse(candidate)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return site


_dir = get_settings().frontend_dir
site = create_site(Path(_dir) if _dir else None)
