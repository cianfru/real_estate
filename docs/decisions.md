# Decisions and open points

## Decisions taken

| # | decision | why |
|---|---|---|
| D1 | PVP is the only data source; AstePlus is never scraped | ToS + database right (art. 102-bis L. 633/1941) |
| D2 | Filter PVP by tribunale label, never by radius | radius silently drops lots without coordinates (114 → 66 in Padova) |
| D3 | "Upcoming" = page the full search sorted by sale date desc and stop at today | `filtroAnnunci=1` only covers ~60 days |
| D4 | Lot identity = tribunale + RGE number/year + lot code; provisional key with comune when the year is unknown | PVP ids change every round; see data-model.md |
| D5 | Round history from a search by procedure, not `/vendite-precedenti` | the endpoint is almost always empty |
| D6 | Denormalised "current round" columns on `lotti` | list and map need one indexed table at ~18k lots |
| D7 | Sync SQLAlchemy + FastAPI sync endpoints | low traffic (2–5 users); simpler code and tests |
| D8 | Session = JWT in an httpOnly cookie; mutating requests need `X-Requested-With: fetch` | simple CSRF protection that also works if the API is on another site |
| D9 | One container serves the React app at `/` and the API at `/api` (`app.server`); the browser only talks to its own origin | first-party cookies, `SameSite=Lax`, no proxy, one service to deploy |
| D10 | Map clustering in MapLibre, not server-side | ≤ 20k points as compact GeoJSON (~1.5 MB, gzip ~300 KB) |
| D11 | `STORE_PROFESSIONAL_CONTACTS=false` by default; SOGGSPV (viewing contact) included when on; judges never | pending decision by the firm, data minimisation |
| D12 | No PDF mirroring; link to `resource-pvp.giustizia.it` | perizie may contain personal data |
| D13 | Geocoding only where PVP gave no coordinates; Nominatim 1 req/s; comune centroid fallback shown as a hollow marker | zero cost; honest about precision |
| D14 | Valore di stima extracted from the description text when stated | PVP has no structured field |
| D15 | Photo passthrough `/public/img` restricted to `/immagini-beni/` images, nothing stored | PVP's bucket headers make photos unembeddable (ORB); documents stay plain links |
| D16 | First sync is a silent bootstrap; `first_seen` = PVP publication date | otherwise the first alert digest would list 17,000 lots and "new in 7 days" would be meaningless |
| D17 | Sales without a court grouped under pseudo-tribunale `ESATTORIALE` | ~275 tax-collector auctions have no `codiceTribunale` |
| D18 | Geocoding tries free text, then structured street + city, then the street without number, then the comune centroid | PVP addresses carry noise ("n.civ presunto", "lotto 2E", several streets) |
| D19 | Interface without pills, chips, outlined buttons or boxed badges: text actions, a gold underline for the selection, dot toggles, underline-only inputs, small-caps status text, serif headings | the firm's direction: "super clean, extremely elegant, no pills" |
| D20 | Zone value = median first-round price per m² (the court expert's appraisal) over six years, by segment, in ≈2 km hexagons → comune → ≈8 km hexagons → province, leave-one-out | the only free, national, geolocated valuation source we have; see market-analysis.md |
| D21 | Opportunity = ≥ 35% below the zone's appraisals **and** ≥ 25% below the zone's auction prices, own appraisal 0.6–1.6× the zone, never at province level, never land or partial ownership | a single threshold flagged ~30% of lots, mostly ordinary later rounds |
| D22 | Market history (`storico_vendite`) from search pages only, ≈ 500 requests one-off, then from the nightly list | details for 250k sales would take days of PVP traffic |
| D23 | PVP's 2025 coverage hole is detected from the data; first sales in the 12 months after it are not used as appraisals and the index shows a gap | otherwise reduced rounds read as low appraisals and fake a −39% trend |
| D24 | Price index = rolling 12-month median per quarter, ≥ 3 own and ≥ 8 window observations, never across a gap | provinces have 20–40 priced sales a quarter; raw quarters are noise |
| D25 | Hosting: Railway Hobby (web + nightly cron from one image) and Neon free for Postgres/PostGIS; no Vercel | Vercel's Hobby plan is "restricted to non-commercial personal use only" (Fair Use Guidelines) and Pro is paid per member; the firm already has Railway Hobby |
| D26 | Staff accounts are managed from the Admin page by invitation: the person gets a one-time link (hashed in the database, 7 days) and chooses their own password; resets work the same way; deactivation and password changes end open sessions at once | nobody knows anyone else's password, no terminal after setup, works without email (the admin copies the link) |
| D27 | A deployment keeps resuming its first load at each start until the national sync and the market history have each succeeded once (max 3 tries each); interrupted runs are closed at startup; the empty map and the empty Mercato page say what is happening, with the admin's button | no terminal and no manual step after deploying; a deploy during a job never blocks the Admin buttons or leaves Mercato empty |
| D28 | Client area (`/portale`): clients log in with the same invite-link system and see only the properties linked to them and visible, with the share-page facts, the status and the firm's message. Client logins are `users` rows with `cliente_id`; `current_user` refuses them everywhere else | requested by the firm owner on 23/10/2026, who accepted storing a name and an email per client contact (personal data: the firm should mention it in its privacy notice and GDPR register) |
| D29 | Map labels in Italian: every basemap label shows `name:it`, else the local name | OpenFreeMap styles default to English (Padua, Venice, Lombardy) |

## Known limitations

- **Geocoding precision.** Public Nominatim misses many Italian civic addresses. In the dev
  sandbox (shared egress IP, probably throttled) 43 of 488 active Veneto lots ended on the comune
  centroid (hollow markers). From the production server it should do better; if not, a paid
  geocoder can be plugged in through the `Geocoder` protocol (`ingest/geocode.py`), which would
  add a running cost and needs the firm's OK.
- The national backlog of ~6,700 lots without coordinates drains at `GEOCODE_LIMIT` (800) per
  night, Veneto first.
- **Zone values describe the auction market**, not open-market listing prices, and many surfaces
  are read from the description text. See `market-analysis.md` "Limitations".
- **No recent appraisals until early 2027**, because of PVP's 2025 coverage hole (D23). Zone values
  rest on 2020–2025 appraisals; the 12-month trend stays hidden until then.

## Pending (need the firm's input)

- **Client area and GDPR**: client logins store a name and an email per person. Add a line to the
  firm's GDPR register (purpose: sharing selected auctions with the client; legal basis: the
  mandate; retention: until access is removed) and to the privacy notice given to clients.

- **STORE_PROFESSIONAL_CONTACTS**: enable to show delegato / custode / viewing contact on the card.
  Needs a short note in the firm's GDPR register (legitimate interest, source = public PVP
  listing, retention = until the lot is concluded + N months).
- **AstePlus field inventory**: waiting for screenshots of an AstePlus property page and its filters.

## Fields to compare with AstePlus

Fill this in when the screenshots arrive. ✅ = we have it, ❓ = check whether AstePlus has it.

| field | us | AstePlus | note |
|---|---|---|---|
| Prezzo base, offerta minima, rialzo minimo | ✅ | ❓ | |
| Valore di stima | partial (from text) | ❓ | AstePlus may read it from the perizia |
| Sconto vs stima % | ✅ when stima is known | ❓ | |
| Ribasso vs primo esperimento % | ✅ | ❓ | |
| €/m² | ✅ when surface is known | ❓ | |
| Storico esperimenti | ✅ (history sync) | ❓ | |
| Occupazione | ✅ | ❓ | |
| Dati catastali | ✅ | ❓ | |
| Deposito cauzionale | ✅ | ❓ | |
| Modalità di vendita | ✅ | ❓ | |
| Delegato / custode | behind flag | ❓ | |
| Siti di pubblicità | ✅ | ❓ | |
| Valore di zona €/m² | ✅ from court appraisals (market-analysis.md) | ❓ | OMI open data would add an open-market reference |
| Link Formaps / mappe catastali | ❌ | ❓ | |
| Abusi / difformità, spese condominiali, vincoli | ❌ | ❓ | later: LLM extraction from the perizia, manual trigger |

## How to add a field

1. Backend: column in `models.py` + Alembic migration; map it in `ingest/mapping.py`; expose it in
   `schemas.LottoDetail` (and `PublicLotto` only if clients may see it).
2. Filter: add it to `schemas.LottoFilters`, `routers/lotti.filters_from_query` and
   `services/lotti_query.apply_filters`. Saved searches and alerts pick it up automatically.
3. Frontend: `src/lib/types.ts`, then the card section in `src/components/LottoCard.tsx` and, for a
   filter, `src/components/Filters.tsx` + `src/lib/filters.ts`.
