# One image for Railway: the web service serves the React app at / and the API at /api
# (app.server); the cron service runs the nightly job from the same image.

FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 FRONTEND_DIR=/app/web
WORKDIR /app

COPY backend/pyproject.toml ./
COPY backend/app ./app
COPY backend/ingest ./ingest
RUN pip install .

COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY --from=web /web/dist ./web

# Railway injects $PORT. Migrations run on every start (they are idempotent).
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.server:site --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
