# Runbook

## Architecture

```
Vercel (frontend, static)  ──/api/* rewrite──▶  Railway "api" service (FastAPI, Docker)
                                                     │
Railway "cron" service (same image) ── nightly ──▶   Postgres 16 + PostGIS (Neon free tier or Railway)
       python -m ingest nightly --scope italy          ▲
                    │                                   │
                    ├─▶ pvp.giustizia.it (≈ 1 req/s)    │
                    ├─▶ nominatim.openstreetmap.org     │
                    └─▶ api.resend.com (alert emails)   │
```

Expected cost: Neon free tier (0.5 GB is ample: the national dataset is ~150 MB) + Railway Hobby
($5/month, which includes $5 of usage; the API idles at a few cents a day and the cron runs ~20
minutes a night) + Vercel Hobby (free) + Resend free (3,000 emails/month). **≈ €5/month.**
Fully free alternative: run the nightly job on GitHub Actions (`.github/workflows/nightly-sync.yml`,
set the repo variable `NIGHTLY_ON_GITHUB=true`) and host the API on any free container host.

## First deployment

1. **Database.** Create a Neon project (region Frankfurt) and run `CREATE EXTENSION postgis;`
   once, or add Railway's PostGIS template. Copy the connection string.
2. **API on Railway.** New service from this GitHub repo, root directory `backend`, config file
   `backend/railway.json`. Variables: see `backend/.env.example` (at least `DATABASE_URL`,
   `JWT_SECRET`, `PUBLIC_APP_URL`, `COOKIE_SECURE=true`). Migrations run on start.
   Generate a domain, check `https://<api>/health` returns `{"status":"ok"}`.
3. **Cron on Railway.** Second service from the same repo, root `backend`, config file
   `backend/railway.cron.json` (start command `python -m ingest nightly --scope italy`, schedule
   `17 1 * * *` UTC ≈ 03:17 Rome in summer / 02:17 in winter). Same variables as the API
   (share them with a Railway variable group).
4. **Frontend on Vercel.** Import the repo, root directory `frontend`. Edit `frontend/vercel.json`:
   replace `REPLACE-WITH-YOUR-API.up.railway.app` with the API domain. No env vars needed.
   Set `PUBLIC_APP_URL` on Railway to the Vercel URL.
5. **Staff users.** From your machine with `DATABASE_URL` pointing at production:
   ```
   cd backend && pip install -e .
   python -m ingest create-user avv.vella@legalestateitalia.it "Mariagiovanna Vella" --admin
   python -m ingest create-user collaboratore@legalestateitalia.it "Nome Cognome"
   ```
   (or `railway run python -m ingest create-user ...`). The password is prompted (min 10 chars).
   Running the command again for an existing email resets the password.
6. **First sync.** Admin page → "Avvia sincronizzazione" (Italia), or
   `railway run python -m ingest sync --scope italy`. It takes ~20 minutes (≈ 1,000 PVP
   requests). The first sync is a silent *bootstrap*: no events, no alert emails.
7. **Resend.** Verify the sending domain (`legalestateitalia.it`) in Resend, then set
   `RESEND_API_KEY` and `EMAIL_FROM`. Without a key, alerts are written to the log.

## Daily operation

The nightly job does, in order:

1. `sync --scope italy`: national list (~36 requests), Veneto lists, details for new/changed
   Veneto sales, round history for new Veneto procedures, outcomes of recently concluded sales,
   unseen-lot marking.
2. `geocode`: up to `GEOCODE_LIMIT` lots without coordinates, Veneto first.
3. `alerts`: one digest per user for that run's `new_lot`, `new_round`, `price_drop` events.

Every step writes a row in `ingest_runs`, visible on the **Admin** page with counts and errors.

## Common tasks

| task | command |
|---|---|
| rerun a sync now | Admin page button, or `python -m ingest sync --scope veneto` (fast) / `--scope italy` |
| list only, no details | `python -m ingest sync --scope italy --no-details` |
| refresh one sale | card → ⟳ button, or `python -m ingest detail <pvp_id>` |
| enrich another court | Admin page → "Attiva un altro tribunale", or `python -m ingest tribunali --activate 0280600097` |
| geocode now | `python -m ingest geocode --limit 300` |
| resend today's alerts | `python -m ingest alerts --run-id <sync run id>` (already-sent events are skipped) |
| reset a password | `python -m ingest create-user <email> "<name>"` again |
| disable a user | `UPDATE users SET is_active = false WHERE email = '...';` |

## When PVP changes

Symptoms: a run on the Admin page is **failed** with `SchemaDriftError`, or `PvpError ... HTTP 404`.

1. **404 on every call**: the microservice hash changed. The client re-reads it from
   `bo-ms/fe-config/pvp` at each run, so this only breaks if the `bo-ms` path itself changed.
   Open `https://pvp.giustizia.it/pvp/`, view source, find `"bo-ms":{"url":"/bo-XXXX/bo-ms"}` in
   any widget's `config` attribute and update `FE_CONFIG_PATH` (and `DEFAULT_MS`) in
   `backend/ingest/pvp_client.py`.
2. **SchemaDriftError: field 'x' lost**: PVP renamed a field. Fetch one payload by hand
   (`curl -X POST '<ric>/ricerca/vendite?page=0&size=1' -H 'Content-Type: application/json' -d '{"tipoLotto":"IMMOBILI"}'`),
   find the new name, update `ingest/mapping.py`, re-record the affected fixture in
   `backend/tests/fixtures/pvp/` (anonymise it: no names, no tax codes), run `pytest`.
3. **Write it down** in `docs/pvp-api.md` before (or with) the fix.
4. A failed run changes nothing destructive: lots are only flagged unknown after a *complete*
   list sync, so a broken night never hides lots.

## GDPR switches

- Turn on professional contacts: set `STORE_PROFESSIONAL_CONTACTS=true` on both services; they
  are filled at the next detail fetch. Turn off: set it to `false` and run
  `TRUNCATE contatti_professionali;`.
- Client data is display name + notes only; deleting a client removes its links.

## Rotating secrets

| secret | how |
|---|---|
| `JWT_SECRET` | change it on Railway (API service) and redeploy: everyone is logged out |
| `DATABASE_URL` | rotate the password in Neon/Railway, update both Railway services (and GitHub secret if used) |
| `RESEND_API_KEY` | create a new key in Resend, update both services, delete the old key |
| staff password | `python -m ingest create-user <email> "<name>"` |

## Backups

Neon keeps point-in-time history on the free tier (24 h). For a weekly offline copy:
`pg_dump "$DATABASE_URL" -Fc -f aste-$(date +%F).dump`. Everything except notes, clients,
saved searches and share links can be rebuilt from PVP with a full sync.
