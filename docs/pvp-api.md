# PVP API: what we use and how

The Portale delle Vendite Pubbliche (`pvp.giustizia.it`) has no documented API. Everything below was
reconstructed in October 2026 from the site's Angular bundles (`lista-annunci`, `dettaglio-annunci`,
`area-annunci` widgets) and verified with live requests. **Treat it as unstable.** When PVP surprises
us, write it down here first, then work around it.

No login, cookies or API key are needed. All responses are JSON.

## Being a polite client

`ingest/pvp_client.py` enforces this for every call:

- at most 1 request per second (`PVP_MIN_INTERVAL_S`)
- exponential backoff (2 s → 120 s, 6 attempts) on 429, 5xx and network errors; honours `Retry-After`
- a descriptive User-Agent (`PVP_USER_AGENT`)
- page size 500 (the maximum the search accepts), so a full national sync is ~40 requests
- details are fetched only for new or changed rows, and only for the active tribunali
- the job runs once a night

## Base URLs are resolved at runtime

PVP is a set of microservices whose paths contain a deploy hash, e.g.
`/ric-496b258c-986a1b71/ric-ms`. The hash will change on redeploys, so the client reads it from the
same config endpoint the PVP frontend uses:

```
GET https://pvp.giustizia.it/bo-5897bc47-986a1b71/bo-ms/fe-config/pvp
```

```json
{
  "host": "https://pvp.giustizia.it",
  "bucketsHost": "https://resource-pvp.giustizia.it",
  "msUrl": {
    "ricerca":    "ric-496b258c-986a1b71/ric-ms",
    "vendite":    "ve-3f723b85-986a1b71/ve-ms",
    "backoffice": "bo-5897bc47-986a1b71/bo-ms",
    "...": "..."
  }
}
```

If that call fails, the client falls back to the last known values in `DEFAULT_MS`. If the `bo-ms`
hash in `FE_CONFIG_PATH` itself changes, update it from the `config` attribute on any widget element
in the HTML of `https://pvp.giustizia.it/pvp/` (`systemParams.api["bo-ms"].url`).

Below, `{ric}`, `{ve}` and `{bo}` stand for `host + "/" + msUrl.<name>`.

## 1. Search: `POST {ric}/ricerca/vendite`

Query string: `language=it&page=<0-based>&size=<≤500>&sort=<field,dir>` (sort may repeat).
Body (all fields optional; this is exactly what the PVP search form sends):

| field | example | notes |
|---|---|---|
| `tipoLotto` | `"IMMOBILI"` | macro category. Others: `MOBILI`, `VALORI/CREDITI`, … |
| `categoriaLotto` | `"IMMOBILE_RESIDENZIALE"` | one value |
| `categoriaBene` | `["APPARTAMENTO"]` | list |
| `tribunale` | `"Tribunale di PADOVA"` | **the label, not the code.** The code (`0280600097`) silently returns 0 results |
| `procedura`, `anno` | `"93"`, `"2024"` | RGE number and year (strings) |
| `prezzoBaseAstaMin`, `prezzoBaseAstaMax` | numbers | |
| `disponibilita` | `0` | enum index: 0 LIBER, 1 OCCUP, 2 OCCST, 3 INCOR, 4 NON_SPECIFICATA |
| `ricercaLibera` | text | free text |
| `flagRicerca` | `0` / `1` | 0 = radius search (`coordIndirizzo`, `raggioIndirizzo`), 1 = geographic (`nazione`, `regione`, `localita`, `indirizzo`) |
| `filtroAnnunci` | `0` / `1` | **0 = published in the last ~30 days, 1 = sale within the next ~60 days.** Omit it for everything |

Response envelope (all PVP endpoints): `{"messaggio": "...", "body": <payload>, "error": null}`.
The search payload is a Spring `Page`: `content[]`, `totalElements`, `totalPages`, `last`, `number`.

### Gotchas

- **There is no "upcoming only" filter.** `filtroAnnunci=1` stops ~60 days out. Without
  `filtroAnnunci` the search returns every sale ever published (272,381 real-estate sales on
  22/10/2026). We sort by `dataOraVendita,desc` and stop paging at the first sale dated before
  today (`PvpClient.iter_upcoming`).
- **Typos in sale dates.** Some sales are dated in the year 2929 or 3019. Sorted descending they
  come first. We skip anything more than 5 years out (`skipped_bad_date` in the run counts).
- **Radius search drops listings without coordinates** (Padova: 114 by tribunale, 66 by 25 km
  radius). We always filter by tribunale, never by radius.
- **No RGE year in search results.** `procedura` is only the number (`"93"`). The year is only in
  the detail. See "Lot identity" in `data-model.md`.
- **Sales without a court.** ~275 upcoming sales (Agenzia Entrate-Riscossione, "esecuzioni
  esattoriali") have empty `codiceTribunale`/`tribunale` and `procedura.codUfficio = null`. We file
  them under the pseudo-tribunale `ESATTORIALE` ("Vendite esattoriali (senza tribunale)").
- Several lots of the same procedure often share the exact same coordinates (same building).
  The map layer fans duplicates out on a ~25 m ring so each stays clickable.
- Filtering by `"Tribunale di VICENZA"` also matches the ex-Bassano court (substring match);
  `codiceTribunale` in each row is reliable.

### Search item → our columns

| PVP field | our column |
|---|---|
| `id` | `vendite.pvp_id` |
| `codiceTribunale`, `tribunale` | `tribunali.pvp_code`, `tribunali.name` |
| `procedura` | `lotti.rge_numero` (normalised) |
| `numeroLotto` | `lotti.lotto_codice` (`"LOTTO UNICO"` → `UNICO`) |
| `tipoLotto`, `categoriaLotto`, `categoriaBene[]` | `lotti.tipo_lotto`, `category`, `categorie_bene` / `subtype` |
| `indirizzo.via / citta / provincia / cap` | `lotti.indirizzo / comune / provincia / cap` |
| `indirizzo.coordinate.latitudine/longitudine` | `lotti.geom` (`geocode_source='pvp'`) |
| `prezzoBaseAsta`, `offertaMinima`, `rialzoMinimo` | `vendite.prezzo_base`, `offerta_minima`, `rialzo_minimo` |
| `dataOraVendita` (Europe/Rome wall time) | `vendite.data_vendita` |
| `dataPubblicazione` | `vendite.data_pubblicazione` |
| `disponibilita[0]` | `lotti.occupazione` |
| `descLotto` | `lotti.descrizione` |
| `esito` | `vendite.esito` (`AGGIU` aggiudicata, `ASDES` deserta) |
| `immagineCover` / `immagine` | `lotti.cover_image_path` |

## 2. Detail: `GET {ve}/vendite/{id}/restricted?language=it`

One sale (esperimento). Main fields:

| PVP field | our column |
|---|---|
| `idVendita` | `vendite.pvp_id` |
| `lotto.idLotto` | `vendite.pvp_lotto_id` (**changes every round**, not a stable lot id) |
| `lotto.codLotto`, `lotto.descLotto`, `lotto.codTipoCategLotto` | `lotti.lotto_codice`, `descrizione`, `category` |
| `lotto.indirizzo` (`descComune`, `codProvincia`, `descRegione`, `coordinate`) | `lotti.*` address and `geom` |
| `procedura.numeRg`, `procedura.numeAnnoRg` | `lotti.rge_numero`, `lotti.rge_anno` |
| `procedura.codUfficio`, `descUfficio`, `descTipoRito` | tribunale, `lotti.tipo_procedura` |
| `dataVendita` + `oraVendita` (`dd/mm/yyyy`, `HH:MM`) | `vendite.data_vendita` |
| `dataTermPresOff` + `oraTermPresOff` | `vendite.termine_offerte` |
| `impoBaseAsta`, `impoOffertaMinima`, `impoOffertaAumento` | prices |
| `codModVendita` (`VENDTEL`, `VENDMIS`, `VENDAS`, `VENDPDO`) | `vendite.modalita` (sincrona telematica / mista / asincrona / presso il venditore) |
| `codTipoVendita` (`SENIN`, `CONIN`, …) | `vendite.tipo_vendita` |
| `flgStatoAnnuncio` (`P` published, `C` concluded) | `vendite.stato_pvp` |
| `codEsito`, `descEsito`, `dataConclusione` | outcome |
| `beni[].superficie` (`"198 mq"`), `numeroVani`, `piano` | `lotti.superficie_mq`, `vani`, `piano` |
| `beni[].disponibilita` | `lotti.occupazione` |
| `beni[].datiCatastali[]` (`textSezione`, `textFoglio`, `textParticella`, `textSubalterno`) | `lotti.dati_catastali` (jsonb) |
| `allegati[]` + `beni[].allegati[]` (`codiceTipoAllegato`, `nomeFile`, `linkAllegato`, `dimensioneAllegato`) | `allegati` (metadata + path only) |
| `datiDeposito.depoCauzionale` | `vendite.deposito_cauzionale` |
| `siti[].urlInserizione` | `vendite.siti_pubblicita` |
| `soggetti[]` (DELEGATO, CUSTODE, SOGGSPV, GIUDICE: names, phone, email, **tax code**) | **not stored**, except DELEGATO/CUSTODE/SOGGSPV in `contatti_professionali` when `STORE_PROFESSIONAL_CONTACTS=true`. The judge is never stored |
| `codFiscaleCustode` | **never stored** |

Attachment codes: `AVEND` avviso, `PERIZ`/`STIMA` perizia, `ORDIN`/`PROVV` ordinanza, `IMGBE` photo,
`ALTRO` other (we look at the description for "planimetria", "foto", …).

There is **no structured "valore di stima"**. We extract it from the description when the text
states it ("valore di stima € 185.000"), which is rare. Field kept for AstePlus comparison.

## 3. Previous rounds: `GET {ve}/vendite/lotti/{idLotto}/vendite-precedenti`

Returns the rounds PVP explicitly linked to this one (via the delegato's "duplica esperimento"
action). In practice it is **almost always empty** or contains only the current sale, because
`idLotto` changes every round. We do not rely on it. Instead, round history comes from a search by
`tribunale + procedura + anno` without `filtroAnnunci`, which returns every round of every lot of
the procedure, past ones with their `esito` (`Syncer.history_sync`).

## 4. Files: `{bucketsHost}{linkAllegato}`

`https://resource-pvp.giustizia.it/allegati/4601150/12207557_avviso.pdf?versionId=...`
(photos under `/immagini-beni/...`). Public, supports range requests. We store the path and link to
it; we never download or mirror the PDFs.

**Photos cannot be embedded directly.** The bucket serves everything as
`application/octet-stream` with `X-Content-Type-Options: nosniff` and `Cache-Control: private`, so
browsers block them as cross-origin images (Chrome: `ERR_BLOCKED_BY_ORB`). The API exposes
`GET /public/img?path=/immagini-beni/...&v=<versionId>`, which streams the photo with the right
`image/*` type and a 7-day browser cache. Only `/immagini-beni/<n>/<n>/<file>.<jpg|png|webp|gif>`
is accepted (never documents) and nothing is stored server-side.

Attachment types: the delegato's description is more reliable than the PVP code (an
"Avviso di vendita" is often uploaded as `ORDIN`/`PROVV`), so `classify_attachment` checks keywords
first.

## 5. Reference lists

| endpoint | content |
|---|---|
| `GET {ve}/tribunali` | `codUfficio`, `nomeUfficio` for every court (incl. Corti d'Appello) |
| `GET {bo}/filtriRicercaVendite` | categories (`tipoLotto` → `tipoCategoriaLotto` → `tipoCategoriaBene`), nations/regions/provinces/comuni |
| `GET {bo}/categorie/tipoEsito`, `tipoModVendita`, `tipoAllegato`, `tipoDispBene`, `tipoVendita` | code tables |

Veneto courts (code, label):

| code | label |
|---|---|
| 0280600097 | Tribunale di PADOVA |
| 0241160092 | Tribunale di VICENZA |
| 0260860099 | Tribunale di TREVISO |
| 0270420098 | Tribunale di VENEZIA |
| 0290410098 | Tribunale di ROVIGO |
| 0240120092 | Tribunale di VICENZA ex Tribunale di BASSANO DEL GRAPPA |

## 6. Volume (22/10/2026)

Upcoming real-estate sales (sale date ≥ today):

| scope | upcoming | all-time in PVP |
|---|---|---|
| Padova | 114 | 2,691 |
| Vicenza | 137 | 3,974 |
| Treviso | 98 | 2,964 |
| Venezia | 50 | 1,695 |
| Rovigo | 100 | 5,832 |
| **5 Veneto courts** | **499** | |
| **Italy** | **17,703** | 272,381 |

So: national list sync ≈ 36 search requests; Veneto details ≈ 500 requests the first night and a
few dozen afterwards; round history ≈ one search per procedure, refreshed every 30 days.

## 7. First live run (22/10/2026)

`python -m ingest sync --scope italy` from an empty database: 20 minutes, 968 PVP requests,
0 errors. 18,192 list rows, 17,568 lots, 498 Veneto details, 381 procedures of round history
(1,197 rows), 301 new rounds linked to existing lots, 7 provisional lots merged after their
detail, 487 provisional keys confirmed, 12 rows skipped for impossible sale dates.
39 % of national lots have no PVP coordinates (Veneto: 30 %).

## 8. Fixtures

`backend/tests/fixtures/pvp/` holds real responses recorded on 22/10/2026, anonymised: every
`soggetti` entry has placeholder names/phones/emails and every tax code is replaced with the
well-known fake `RSSMRA80A01H501U` (so the scrubbing code is exercised).
