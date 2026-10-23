import logging

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import get_settings
from app.db import engine
from app.routers import admin, analytics, auth, clienti, images, lotti, meta, portale, public, saved_searches, users

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(
    title="Legal Estate · Aste",
    version="1.0.0",
    description="Internal API built on the Portale delle Vendite Pubbliche (pvp.giustizia.it).",
    docs_url="/docs",
    openapi_url="/openapi.json",
)
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@app.exception_handler(RequestValidationError)
async def readable_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    """One short Italian sentence for the screen instead of pydantic's English list; the full
    list stays under `errors` for debugging."""
    first = exc.errors()[0] if exc.errors() else {}
    field = str(first.get("loc", ["", ""])[-1])
    message = (
        "Indirizzo email non valido"
        if "email" in field
        else f"Valore non valido: {field}"
        if field
        else "Richiesta non valida"
    )
    return JSONResponse({"detail": message, "errors": jsonable_encoder(exc.errors())}, status_code=422)


@app.middleware("http")
async def csrf_guard(request: Request, call_next):  # type: ignore[no-untyped-def]
    """State-changing requests must carry X-Requested-With, which HTML forms cannot set and
    cross-origin scripts can only send after a CORS preflight we control."""
    if request.method not in SAFE_METHODS and request.headers.get("x-requested-with") != "fetch":
        return JSONResponse({"detail": "Richiesta non valida (CSRF)"}, status_code=403)
    return await call_next(request)


for r in (
    auth.router,
    lotti.router,
    meta.router,
    saved_searches.router,
    clienti.router,
    public.router,
    images.router,
    analytics.router,
    admin.router,
    users.router,
    portale.router,
):
    app.include_router(r)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    with engine.connect() as c:
        c.execute(text("select 1"))
    return {"status": "ok"}
