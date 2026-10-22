# Runbook

## Architecture

```
                 https://<app>.up.railway.app (or your domain)
                                   │
Railway "web" service ── one Docker image (root Dockerfile) ──────────────┐
   app.server: React app at /, FastAPI at /api, /health                    │
                                                                          ▼
Railway "cron" service ── same image, 01:17 UTC ──────────▶  Postgres 16 + PostGIS
   python -m ingest nightly --scope italy                   (Neon free tier, Frankfurt)
        ├─▶ pvp.giustizia.it (≈ 1 req/s)
        ├─▶ nominatim.openstreetmap.org
        └─▶ api.resend.com (alert emails)
```

The website and the API share one origin, so the session cookie is first-party and nothing has
to proxy the API (decision D9). Vercel is not used: its free plan is for non-commercial use only
(D25).

Expected cost: **Railway Hobby, $5/month**, which includes $5 of usage. The web service idles at
~100 MB of memory and the nightly job runs ~30 minutes (peak ~600 MB during the analysis), which
should stay within the included usage; check *Usage* in Railway after the first month. Neon free
tier (0.5 GB; the national dataset is ~170 MB) and Resend free (3,000 emails/month) cost nothing.
Free alternative for the nightly job: GitHub Actions (`.github/workflows/nightly-sync.yml`, repo
variable `NIGHTLY_ON_GITHUB=true`), with the Railway cron service removed.

## First deployment

1. **Database (Neon, free).** Create a project in region *AWS Europe Central 1 (Frankfurt)*.
   In the SQL editor run `CREATE EXTENSION IF NOT EXISTS postgis;`. Copy the connection string
   with **connection pooling off** (the direct one, `...neon.tech/neondb?sslmode=require`): the
   app keeps its own pool, and psycopg's prepared statements don't go through PgBouncer.
   (Alternative: Railway's PostGIS template in the same project, billed as usage.)
2. **Web service.** Railway → *New project* → *Deploy from GitHub repo* → this repository. Railway
   reads `railway.json` at the root and builds the root `Dockerfile` (frontend + API, ~3 minutes).
   Rename the service `web`. In *Settings → Source* pick the branch to deploy. *Variables*:

   | variable | value |
   |---|---|
   | `DATABASE_URL` | the Neon string (`postgres://` or `postgresql://` both work) |
   | `JWT_SECRET` | 64 random characters, e.g. `openssl rand -hex 32` |
   | `COOKIE_SECURE` | `true` |
   | `PUBLIC_APP_URL` | `https://<the domain from the next step>` (used in share links and emails) |
   | `NOMINATIM_EMAIL` | the firm's address (Nominatim's usage policy asks for a contact) |
   | `RESEND_API_KEY`, `EMAIL_FROM` | optional, see step 7 |

   *Settings → Networking → Generate domain* (or add `aste.legalestateitalia.it` as a custom
   domain). Migrations run at every start. Check `https://<domain>/health` → `{"status":"ok"}`.
3. **Cron service.** In the same project: *New → GitHub repo* → the same repository. Rename it
   `cron`. *Settings → Config-as-code*: Railway config file `/railway.cron.json` (start command
   `python -m ingest nightly --scope italy`, schedule `17 1 * * *` UTC ≈ 03:17 Rome in summer,
   02:17 in winter). Same branch as `web`. *Variables*: reference the web service's, e.g.
   `DATABASE_URL=${{web.DATABASE_URL}}`, and the same for `JWT_SECRET`, `PUBLIC_APP_URL`,
   `NOMINATIM_EMAIL`, `RESEND_API_KEY`, `EMAIL_FROM`.
4. **Staff users.** With the Railway CLI (`npm i -g @railway/cli`, `railway login`,
   `railway link`):
   ```
   railway ssh --service web
   python -m ingest create-user avv.vella@legalestateitalia.it "Mariagiovanna Vella" --admin
   python -m ingest create-user collaboratore@legalestateitalia.it "Nome Cognome"
   ```
   The password is prompted (min 10 characters). Running the command again for an existing
   email resets the password.
5. **First sync.** Log in → Admin → "Avvia sincronizzazione" (Italia). ~20 minutes, ≈ 1,000 PVP
   requests. The first sync is a silent *bootstrap*: no events, no alert emails.
6. **Market history**, once, from `railway ssh --service web`:
   ```
   nohup sh -c 'python -m ingest history --scope italy --since 2019-01-01 && python -m ingest analytics' > /tmp/history.log 2>&1 &
   ```
   ≈ 500 PVP requests, about 10 minutes, then ≈ 30 s of analysis (`tail -f /tmp/history.log`; it
   keeps running if the SSH session drops). Until this has run the Mercato page and the zone layer
   are empty. The first analysis with data is silent (no opportunity events).
7. **Resend (optional).** Verify the sending domain (`legalestateitalia.it`) in Resend, then set
   `RESEND_API_KEY` and `EMAIL_FROM` on `web` (the cron references them). Without a key, alerts
   are written to the log.

Every push to the deployed branch rebuilds both services (docs-only changes don't, see
`watchPatterns` in `railway.json`).

## Daily operation

The nightly job does, in order:

1. `sync --scope italy`: national list (~36 requests), Veneto lists, details for new/changed
   Veneto sales, round history for new Veneto procedures, outcomes of recently concluded sales,
   unseen-lot marking.
2. `geocode`: up to `GEOCODE_LIMIT` lots without coordinates, Veneto first.
3. `analytics`: zone values, price index and opportunities from `storico_vendite`
   (`docs/market-analysis.md`), ≈ 20 s, no PVP requests.
4. `alerts`: one digest per user for that run's `new_lot`, `new_round`, `price_drop` and
   `opportunity` events.

Every step writes a row in `ingest_runs`, visible on the **Admin** page with counts and errors.

## Common tasks

| task | command |
|---|---|
| rerun a sync now | Admin page button, or `python -m ingest sync --scope veneto` (fast) / `--scope italy` |
| list only, no details | `python -m ingest sync --scope italy --no-details` |
| refresh one sale | card → ⟳ button, or `python -m ingest detail <pvp_id>` |
| enrich another court | Admin page → "Attiva un altro tribunale", or `python -m ingest tribunali --activate 0280600097` |
| geocode now | `python -m ingest geocode --limit 300` |
| recompute zone values and opportunities | `python -m ingest analytics` |
| reload market history | `python -m ingest history --scope italy --since 2019-01-01` (idempotent upsert) |
| change the opportunity thresholds | set `OPPORTUNITY_THRESHOLD_PCT` / `OPPORTUNITY_AUCTION_PCT` on the cron service, then run `analytics` |
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
