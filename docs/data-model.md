# Data model

Postgres 16 + PostGIS. Models in `backend/app/models.py`, migrations in `backend/alembic/versions/`.

```
tribunali 1─n lotti 1─n vendite 1─n allegati
                 │          └──1─n contatti_professionali   (only with STORE_PROFESSIONAL_CONTACTS)
                 ├──1─n eventi  (n─1 vendite, n─1 ingest_runs)
                 ├──1─n note ─ users
                 ├──n─n clienti   (through lotto_cliente, with a status)
                 └──1─n share_links
users 1─n saved_searches;  alert_log (user, evento) unique
geocode_cache, ingest_runs: standalone
```

## Core tables

### `tribunali`
`pvp_code` (PVP `codUfficio`), `name` (the exact PVP label, used to filter the search), `short_name`,
`region`, `active_for_enrichment`. The 5 Veneto courts are seeded active by migration `0002`; every
other court is created on the fly from the national list or from `GET ve-ms/tribunali`. Toggle a
court with `python -m ingest tribunali --activate <code>` or from the Admin page.

### `lotti`: the persistent property across auction rounds
Identity (`lot_key`, see below), tribunale, RGE number/year, lot code, category/subtype, address,
`geom geography(Point,4326)` + `geocode_source` (`pvp` | `nominatim` | `comune`) +
`geocode_confidence`, surface, rooms, floor, description, cadastral data (jsonb), occupancy,
`first_seen`, `last_seen`, `status`, `missed_runs`, `merged_into_id`, `history_synced_at`.

It also carries a **denormalised snapshot of the current round** (`current_vendita_id`,
`prezzo_base`, `offerta_minima`, `data_vendita`, `termine_offerte`, `modalita`,
`prezzo_primo_esperimento`, `n_rounds`, `last_price_drop_at`), refreshed by
`Syncer.refresh_lotto_summary` after every write. This keeps list and map queries to one table.
The *current* round is the earliest upcoming one, or the latest past one if none is upcoming.

`status`:

| value | meaning |
|---|---|
| `active` | has an upcoming round that PVP still lists |
| `sold` | the latest round ended with `AGGIU` |
| `unknown` | the latest round is past with no sale (deserted, or outcome not yet published), or the upcoming round has been missing from PVP for `UNSEEN_RUNS_BEFORE_UNKNOWN` (3) consecutive syncs |
| `withdrawn` | reserved (PVP gives no explicit withdrawal signal yet) |
| `merged` | provisional lot folded into another one (`merged_into_id`) |

Rows are never hard-deleted.

**Valuation columns**, written by the nightly analytics (`docs/market-analysis.md`):
`segment` (residenziale / commerciale / industriale / box / terreni), `superficie_source`
(`pvp` | `testo`), `quota_parziale`, `eur_mq` (current base price per m²), `eur_mq_stima` (own
appraisal per m²), the benchmark zone (`zona_level`, `zona_key`, `zona_label`, `zona_n`,
`zona_eur_mq`, `zona_p25`, `zona_p75`, `zona_asta_eur_mq`), the discounts `sconto_zona_pct` and
`sconto_aste_pct`, and `opportunity` + `opportunity_since`.

### `vendite`: one auction round
`pvp_id` (unique), `lotto_id`, `data_vendita`, `termine_offerte`, prices, `modalita`,
`tipo_vendita`, `valore_stima`, `round_number` (1-based, by date), `stato_pvp`, `esito`,
`esito_desc`, `data_conclusione`, `deposito_cauzionale`, `siti_pubblicita` (jsonb),
`raw_list` + `raw` (scrubbed search item and detail), `list_hash`, `content_hash`
(sha256 of the scrubbed detail), `detail_list_hash` (list hash at the last detail fetch),
`list_fetched_at`, `fetched_at`, `last_seen`, `missed_runs`.

A detail is (re)fetched when `fetched_at IS NULL` or `detail_list_hash <> list_hash`, i.e. only when
the search row changed.

### `allegati`
Attachment metadata only: `tipo` (`perizia` / `avviso` / `ordinanza` / `foto` / `planimetria` /
`other`), PVP type code, description, filename, `path` (relative to `resource-pvp.giustizia.it`),
size. **Files are never downloaded or mirrored.**

### `contatti_professionali`
`vendita_id`, `role` (DELEGATO, CUSTODE, SOGGSPV = viewing contact), `name`, `email`, `phone`.
Written only when `STORE_PROFESSIONAL_CONTACTS=true` (default false). Isolated so it can be
truncated or dropped (`TRUNCATE contatti_professionali` or a migration dropping the table) without
touching anything else. Judges are never stored, tax codes are never stored.

### `eventi`: the change log
`lotto_id`, `vendita_id`, `run_id`, `tipo`, `old` (jsonb), `new` (jsonb), `at`.

| tipo | when |
|---|---|
| `new_lot` | an upcoming sale that matches no known lot |
| `new_round` | an upcoming sale attached to a lot that already had rounds |
| `price_drop` | new round cheaper than the previous one, or a round's base price lowered |
| `price_change` | a round's base price raised |
| `deadline_changed` | offer deadline changed |
| `postponed` / `date_changed` | sale date moved later / earlier |
| `cancelled` | upcoming sale missing from PVP for N consecutive syncs |
| `outcome` | PVP published an `esito` |
| `geocoded` | we placed the lot on the map (not shown in the UI feed) |

Past rounds imported by the history sync are inserted silently (no events).

### `geocode_cache`
Normalised query string (PK) → lat/lon/source/confidence. Negative results are cached too, so
Nominatim is never asked the same thing twice.

### `ingest_runs`
`kind` (`sync` / `geocode` / `analytics` / `alerts` / `history`), `scope`, `status` (`running` / `ok` / `failed`),
`started_at`, `finished_at`, `counts` (jsonb), `errors` (jsonb). Shown on the Admin page.

## Market analysis tables

Rebuilt by `python -m ingest analytics`; see `docs/market-analysis.md`. No personal data.

- `storico_vendite`: one slim row per PVP real-estate sale since 2019 (PK `pvp_id`): court,
  RGE number, lot code, comune, provincia, lat/lon, category/subtype/segment, surface,
  `quota_parziale`, base price, sale and publication dates, outcome. Filled by the one-off
  `history` backfill and by every list sync.
- `area_stats`: one row per (segment, level, key) with level `hex` | `hexL` | `comune` |
  `provincia` | `italia`: appraisal count, median, p25, p75, auction median of active lots, active
  and opportunity counts, 12-month trend, centre and (hexagons) polygon.
- `price_index`: one row per (segment, level `italia`|`provincia`, key, quarter): rolling median
  appraisal and auction €/m², counts, deserted rounds, and `gap` for quarters PVP left empty.

## App tables

- `users`: staff only, argon2 hashes, `is_admin`, `is_active`, `last_login_at`,
  `password_changed_at` (sessions carry a password version, so a change or reset logs out every
  other session). An invited person has an empty hash until they choose a password. Managed from
  the Admin page; the first admin comes from `ADMIN_EMAIL`/`ADMIN_PASSWORD` or
  `python -m ingest create-user`.
- `password_tokens`: one-time links (`invite` 7 days, `reset` 24 hours). Only the SHA-256 of the
  token is stored; a new link cancels the person's earlier unused ones.
- `saved_searches`: `criteria` (jsonb: the same `LottoFilters` the list uses), optional `polygon`
  (GeoJSON), `alert_enabled`.
- `alert_log`: one row per (user, evento) sent; the unique constraint guarantees an event is never
  emailed twice.
- `clienti`: internal display name + free notes. **No tax codes.** Contact data only as the logins
  below, when the firm gives the client access to their area.
- `lotto_cliente`: lot ↔ client with status `in_valutazione` / `offerta_presentata` /
  `aggiudicato` / `scartato`, `nel_portale` (shown in the client's area, default yes) and
  `nota_cliente` (the firm's message to the client, shown there; never the internal notes).
- Client logins: rows of `users` with `cliente_id` set (name, email, password hash). They can only
  call `/auth/*` and `/portale/*`; every other router depends on `current_user`, which refuses
  them. Deleting a login or the client erases them (`ON DELETE CASCADE`).
- `note`: free text per lot, with author.
- `share_links`: random token (192 bit), `expires_at` (default 30 days), `revoked`.

## Indexes

GiST on `lotti.geom`; btree on `lotti(tribunale_id)`, `prezzo_base`, `termine_offerte`,
`data_vendita`, `status`, `category`, `comune`, `first_seen`; `vendite(lotto_id)`,
`vendite(data_vendita)`; `eventi(lotto_id)`, `(run_id)`, `(at)`.

## Lot identity

PVP creates a **new sale id for every round** and `lotto.idLotto` changes too, so neither identifies
the property. `/vendite-precedenti` is almost always empty (see `pvp-api.md`). Our rule:

> **lot = tribunale code + RGE number + RGE year + normalised lot code**
> e.g. `0280600097|93/2024|1`

Normalisation: RGE number without leading zeros; lot code `"LOTTO UNICO"`, empty or `"U"` → `UNICO`,
`"Lotto 3"`/`"003"` → `3`.

The search endpoint does not return the RGE year. So:

1. A sale seen only in the national list first tries to join an existing lot with the same
   tribunale, RGE number, lot code **and comune**. If exactly one exists, it joins it.
2. Otherwise it gets a **provisional key** `trib|93/?|1|anguillara veneta`
   (`key_is_provisional = true`).
3. When the detail is fetched (always for active tribunali, on demand elsewhere) we learn the year:
   - no lot has the full key → the provisional lot is simply renamed;
   - a lot with the full key exists → the sale moves there and the emptied provisional lot becomes
     `status = merged` with `merged_into_id`; its notes, client links, share links and events move
     with it.
4. For active tribunali, `history_sync` searches `tribunale + procedura + anno` and imports every
   round of the procedure under full keys, so the round timeline is complete from day one.

Edge cases:

- **Lots renumbered between rounds** (e.g. lots 1+2 sold together as "LOTTO UNICO" later): they
  become separate lots. Staff can see the procedure's other lots via the RGE on the card. Merging
  by hand is a possible later admin action.
- **Split lots** (one lot later sold as 1A, 1B): new codes → new lots. Same remedy.
- **Two procedures with the same number in the same court and comune, different years**, both
  only in the national list: ambiguous; we create a provisional lot and count
  `ambiguous_lot_match` in the run. Details resolve it.
- **RGE typos by the delegato** produce a separate lot. Rare; visible as a lot with a single round.

## GDPR

- `ingest.mapping.scrub()` runs on every payload before it is stored (`raw`, `raw_list`) or saved
  as a fixture: it drops `soggetti`, every `cf*`/`codFiscale*` key and masks anything shaped like
  an Italian tax code in free text.
- Debtor names: PVP does not publish them in structured fields; free-text descriptions are kept as
  published by the court (the delegato is responsible for anonymisation there).
- Professional contacts: behind `STORE_PROFESSIONAL_CONTACTS`, own table, judges excluded.
- Clients: display name + notes. A client's area adds, per person given access, a name and an
  email (and a password hash); "Elimina" on the login, or deleting the client, erases them.
