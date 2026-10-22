"""Tiny in-memory sliding-window rate limiter for the public share routes.
Good enough for one API instance; swap for Redis if the API is ever scaled out."""

import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import HTTPException, Request

from app.config import get_settings

_hits: dict[str, deque[float]] = defaultdict(deque)
_lock = Lock()


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def public_rate_limit(request: Request) -> None:
    limit = get_settings().public_rate_limit_per_min
    key = client_ip(request)
    now = time.monotonic()
    with _lock:
        q = _hits[key]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= limit:
            raise HTTPException(429, "Troppe richieste, riprova tra poco")
        q.append(now)
