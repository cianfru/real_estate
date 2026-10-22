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
| D9 | Frontend calls `/api/*` on its own origin; Vercel rewrites to Railway | first-party cookies, `SameSite=Lax`, no third-party cookie issues |
| D10 | Map clustering in MapLibre, not server-side | ≤ 20k points as compact GeoJSON (~1.5 MB, gzip ~300 KB) |
| D11 | `STORE_PROFESSIONAL_CONTACTS=false` by default; SOGGSPV (viewing contact) included when on; judges never | pending decision by the firm, data minimisation |
| D12 | No PDF mirroring; link to `resource-pvp.giustizia.it` | perizie may contain personal data |
| D13 | Geocoding only where PVP gave no coordinates; Nominatim 1 req/s; comune centroid fallback shown as a hollow marker | zero cost; honest about precision |
| D14 | Valore di stima extracted from the description text when stated | PVP has no structured field |

## Pending (need the firm's input)

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
| Valori OMI (€/m² di zona) | ❌ | ❓ | later: Agenzia Entrate OMI open data |
| Link Formaps / mappe catastali | ❌ | ❓ | |
| Abusi / difformità, spese condominiali, vincoli | ❌ | ❓ | later: LLM extraction from the perizia, manual trigger |

## How to add a field

1. Backend: column in `models.py` + Alembic migration; map it in `ingest/mapping.py`; expose it in
   `schemas.LottoDetail` (and `PublicLotto` only if clients may see it).
2. Filter: add it to `schemas.LottoFilters`, `routers/lotti.filters_from_query` and
   `services/lotti_query.apply_filters`. Saved searches and alerts pick it up automatically.
3. Frontend: `src/lib/types.ts`, then the card section in `src/components/LottoCard.tsx` and, for a
   filter, `src/components/Filters.tsx` + `src/lib/filters.ts`.
