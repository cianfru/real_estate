# Notes for Claude Code

Internal judicial-auction tool for the Legal Estate law firm, built on the PVP public API.
Read `README.md` and `docs/` (pvp-api, data-model, market-analysis, decisions, runbook) before changing anything,
and keep them current.

## Hard rules
- PVP (`pvp.giustizia.it`) is the only data source. Never scrape AstePlus.
- Polite PVP client only (`backend/ingest/pvp_client.py`): ≤ 1 req/s, backoff, nightly.
- GDPR: never store debtor names, tax codes, or judges' names. Professional contacts only when
  `STORE_PROFESSIONAL_CONTACTS=true`, in `contatti_professionali`. Every payload goes through
  `ingest.mapping.scrub()` before being stored or saved as a fixture. Never mirror PDFs.
- Zero/near-zero running cost: stop and ask before adding anything paid or storing new personal data.
- When PVP surprises you, document it in `docs/pvp-api.md` first.

## Commands
- Backend: `cd backend && .venv/bin/pytest -q && .venv/bin/ruff check . && .venv/bin/mypy app ingest`
- Frontend: `cd frontend && npm run typecheck && npm test && npm run build`
- Ingest: `python -m ingest sync --scope veneto|italy`, `detail <pvp_id>`, `geocode`, `history`, `analytics`, `alerts`, `nightly`

## Where things live
- Filters: `schemas.LottoFilters` ↔ `services/lotti_query.apply_filters` ↔ `frontend/src/lib/filters.ts`
- Lot identity and events: `ingest/sync.py` (see docs/data-model.md "Lot identity")
- Property card: `frontend/src/components/LottoCard.tsx` + `LottoParts.tsx`
- Staff accounts: `app/routers/users.py` (Admin page) + `app/services/accounts.py` (one-time links)
- Client area: `app/routers/portale.py`, client logins in `routers/clienti.py`; staff routers use
  `current_user` (refuses client logins), the client area `client_user`
- Production entry point: `backend/app/server.py` (website at `/`, API at `/api`), root `Dockerfile`,
  `railway.json` (web) and `railway.cron.json` (nightly); see docs/runbook.md
- Zone values, price index, opportunities: `ingest/analytics.py` (method in docs/market-analysis.md);
  page `frontend/src/pages/Mercato.tsx`, charts `components/charts.tsx`
- Design language: no pills, chips, outlined buttons or boxed badges (decisions.md D19). Use the
  primitives in `frontend/src/components/ui.tsx`.
