# Market analysis

The **Mercato** page, the zone layer on the map, the gold rings and the "Valore di zona" block on
every property card all come from one nightly job, `python -m ingest analytics`
(`backend/ingest/analytics.py`). This page explains what it computes, from which data, and where
the numbers can mislead.

It answers three questions:

1. **What is a property worth here?** The zone's appraised €/m², from the court experts' own
   valuations.
2. **How are prices moving?** A quarterly index of appraisals and of auction base prices.
3. **Which lots are priced well below their zone?** Opportunities, marked in gold.

## The idea

In an Italian judicial auction the **first round's base price is the court expert's valuation**
(the *perizia*). Later rounds drop by up to 25% each. So for every lot we have seen from its first
round, first-round price ÷ surface is an expert-appraised €/m², and PVP's history gives us tens of
thousands of them, geolocated. Their median per zone and segment is the zone's appraised value.

The auction price of a lot *today* (current base price ÷ surface) can then be compared with:

- the **zone's appraised value** (what experts say this kind of property is worth here), and
- the **zone's auction prices** (what auctions here typically ask, all rounds included).

A lot far below both is an opportunity. A lot that is cheap only because its own appraisal was
low (poor condition, wrong surface) is not: we keep both numbers and check them against each other.

## Data

`storico_vendite` holds one slim row per PVP real-estate sale since 2019, nationally, read from
**search pages only** (no detail calls): court, RGE number, lot code, comune, provincia,
coordinates, category, surface, partial-ownership flag, base price, sale date, outcome. No
personal data.

- One-off backfill: `python -m ingest history --scope italy --since 2019-01-01`
  (≈ 500 search requests at 1 req/s, about 10 minutes).
- Every night the list sync adds the upcoming sales and the last 30 days (to pick up outcomes).

On 22/10/2026: **251,798 sales**, 97,539 of them with a usable surface, 7,912 partial-ownership
sales.

### Surface

PVP gives a structured surface only in the detail (`beni[].superficie`), which we fetch for the
Veneto courts. Everywhere else the surface is **extracted from the description**
(`ingest.valuation.extract_surface`): every "N mq" in the text is scored by the words before it
("superficie commerciale" counts most; "balcone", "soppalco", "terreno" count against) and the
best candidate wins. Detail surfaces always beat extracted ones (`lotti.superficie_source`).

### Exclusions

- Sales of a share of the property (*quota*, *nuda proprietà*, *usufrutto*, …): their price is not
  a price per m² of the whole.
- Implausible €/m² for the segment (`ingest.valuation.PLAUSIBLE`), usually a wrong surface.
- Segments: `residenziale`, `commerciale`, `industriale`, `box`, `terreni` (from PVP's category
  and subtype). Land is valued but never flagged as an opportunity.

### Which first sale is an appraisal

Sales are grouped per lot (court + RGE + lot code + comune; a gap of more than 3 years starts a
new procedure). The group's first sale counts as the appraisal only if we could have seen any
earlier round:

- it is at least 12 months after the start of the data (January 2019), and
- none of the 12 months before it is a **PVP coverage hole** (next section).

## The PVP coverage hole (2025)

PVP's search returns almost no sales dated **March 2025 – January 2026**: about 1% of the usual
volume (e.g. 4 sales dated May 2025 nationally, against several thousand in a normal month). The rest of the
history is complete. See `docs/pvp-api.md`.

A lot whose first rounds fell inside the hole shows up afterwards as if its reduced round were
the first one, which would read as a 25–45% lower "appraisal". So:

- **Blind months** are detected from the data: a month with fewer than 10% of the sales of a
  normal month (August is exempt unless July and September are blind too; the 2020 lockdown sits
  at 17–20% and is real, not a hole).
- First sales within 12 months after a blind month are **not used as appraisals**: 12,059 of them
  on 22/10/2026. They still count as auction prices.
- The price index marks those quarters as `gap` and the chart leaves them empty instead of
  drawing a line across.

Consequence: the appraisal line stops at Q1 2025 and resumes once a year of clean data has
passed (early 2027). Zone values rely on the six years of appraisals before the hole. The 12-month
trend is hidden until both windows have enough clean appraisals.

## Zones

Four levels, tried in this order for each lot until there are enough comparable appraisals of the
same segment over the last six years (`ANALYTICS_YEARS`):

| level | what | min. appraisals |
|---|---|---|
| `hex` | hexagon ≈ 2 km across (`HEX_SIZE_M=1200`, centre to corner) | 6 |
| `comune` | the lot's comune | 6 |
| `hexL` | hexagon ≈ 8 km across (4× `hex`) | 8 |
| `provincia` | the lot's province | 8 |

- The lot's own earlier appraisal is left out of its zone (leave-one-out), so a lot never
  benchmarks against itself.
- Zone value = median; the band shown is p25–p75 ("forbice").
- Hexagons are pointy-top, on web-mercator coordinates (`ingest.valuation.hex_key`), so they look
  regular on the map. The map shows `hexL` when zoomed out and `hex` from zoom 10.
- Zones with fewer than 3 appraisals (`hex`, `comune`), 4 (`hexL`) or 5 (`provincia`) are not
  shown at all.

The zone's **auction price** is the median base price per m² of every round (not just first ones)
held in the zone over the same six years.

## Opportunity rule

A lot is an opportunity (gold dot and ring on the map, "Opportunità" on the card, `opportunity`
event for alerts) when **all** of these hold:

| condition | why |
|---|---|
| active, with a surface and a zone | |
| zone level is `hex`, `comune` or `hexL`, not `provincia` | a whole province mixes city centres and countryside |
| segment is residential, commercial, industrial or box | land values are too scattered |
| not a partial-ownership sale | |
| its own appraisal is 0.6–1.6× the zone value | otherwise the surface or the segment is probably wrong, or the property is genuinely different |
| current €/m² ≥ **35%** below the zone's appraised value (`OPPORTUNITY_THRESHOLD_PCT`) | far below what experts value similar property at |
| current €/m² ≥ **25%** below the zone's auction prices (`OPPORTUNITY_AUCTION_PCT`) | cheap even for an auction: not just "a third round like any other" |

The first analytics run is silent; afterwards a lot that becomes an opportunity produces one
`opportunity` event ("Sotto il valore di zona"), which saved-search alerts include.

### Calibration (live data, 22/10/2026)

| zone level | active lots benchmarked | opportunities |
|---|---|---|
| `hex` | 357 | 45 |
| `comune` | 1,840 | 152 |
| `hexL` | 143 | 13 |
| `provincia` | 3,027 | 0 (excluded) |

**210 opportunities nationally out of 17,387 active lots** (145 residential, 35 commercial, 30
box), 4 in Veneto. Median discount among them: 45% below zone appraisals, 42% below zone auction
prices. A first version with a single condition (well below zone appraisals) flagged about 30% of
benchmarked lots, mostly ordinary third and fourth rounds: that is why the auction-price condition
and the consistency check exist.

## Price index

`price_index`: per segment, for Italy and each province, per quarter:

- `stima_eur_mq`: median appraisal (trusted first rounds),
- `asta_eur_mq`: median base price per m² of all rounds,
- counts of appraisals, rounds and deserted rounds.

Values are a **rolling 12-month median** (the quarter and up to three before it), because a
province has only 20–40 priced sales a quarter. A value needs at least 3 observations in the
quarter itself and 8 in the window, and the window never reaches across a gap quarter. Quarters
after the current one (sales already scheduled) are left out.

## Limitations

- **The auction market is not the open market.** Appraisals in judicial auctions are
  conservative and properties are often occupied or in poor condition. Zone values describe
  auction property, not listing prices on Immobiliare.it.
- **Extracted surfaces can be wrong** (a description that only mentions the garden, or the sum of
  several units). The plausibility bounds and the 0.6–1.6× consistency check remove the worst
  cases; the card says when the surface was read from the description.
- **Thin zones.** A `hex` with 6 appraisals is a small sample; the card shows the count and the
  p25–p75 band so the reader can judge.
- **The 2025 hole** (above): no recent appraisals until 2027.
- **Next step (free):** the Agenzia delle Entrate OMI zone values (open data, half-yearly) would
  give an open-market reference per OMI zone. Not done yet.

## Configuration

| variable | default | |
|---|---|---|
| `HEX_SIZE_M` | 1200 | hexagon size (centre to corner, metres) |
| `ANALYTICS_YEARS` | 6 | appraisals older than this are ignored |
| `OPPORTUNITY_THRESHOLD_PCT` | 35 | minimum discount on the zone's appraised value |
| `OPPORTUNITY_AUCTION_PCT` | 25 | minimum discount on the zone's auction prices |

Changing them takes effect at the next `python -m ingest analytics` (≈ 20 s).

## Where things live

- Computation: `backend/ingest/analytics.py`; parsing and hexagons: `backend/ingest/valuation.py`;
  history: `backend/ingest/history.py`
- API: `backend/app/routers/analytics.py` (`/analytics/zones`, `/analytics/overview`), lot fields
  in `routers/lotti.py` (`zona`, `comparables`)
- Frontend: `pages/Mercato.tsx`, `components/AreaValuation.tsx`, `components/charts.tsx`, zone
  layer in `components/MapView.tsx`
