"""Photo passthrough. PVP serves listing photos as application/octet-stream with `nosniff`, which
browsers block cross-origin (ORB). We stream them with the right content type. Only paths under
/immagini-beni/ are allowed (photos, never documents) and nothing is stored on our side."""

from __future__ import annotations

import mimetypes
import re

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.config import get_settings

router = APIRouter(prefix="/public", tags=["public"])

_ALLOWED = re.compile(r"^/immagini-beni/\d+/\d+/[^/]+$")
_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif"}
MAX_BYTES = 8_000_000
_client = httpx.Client(timeout=20, follow_redirects=False)


@router.get("/img")
def image(path: str = Query(..., max_length=500), v: str | None = Query(None, max_length=100)) -> Response:
    if not _ALLOWED.match(path) or ".." in path:
        raise HTTPException(400, "Percorso non consentito")
    ext = "." + path.rsplit(".", 1)[-1].lower() if "." in path else ""
    ctype = _TYPES.get(ext) or mimetypes.guess_type(path)[0] or ""
    if not ctype.startswith("image/"):
        raise HTTPException(400, "Non è un'immagine")
    s = get_settings()
    url = s.pvp_buckets_host + path
    try:
        r = _client.get(url, params={"versionId": v} if v else None, headers={"User-Agent": s.pvp_user_agent})
    except httpx.HTTPError as e:
        raise HTTPException(502, "Immagine non disponibile") from e
    if r.status_code != 200 or len(r.content) > MAX_BYTES:
        raise HTTPException(404, "Immagine non disponibile")
    return Response(
        r.content,
        media_type=ctype,
        headers={"Cache-Control": "public, max-age=604800, immutable", "X-Content-Type-Options": "nosniff"},
    )
