import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Page } from "@/components/AppShell";
import { Columns, Legend, LineChart, Scatter, TableToggle, fmtEurMq, type XBand } from "@/components/charts";
import { Thumb } from "@/components/LottoRow";
import { MapLegend, MapView, quantileBreaks, useZones } from "@/components/MapView";
import { Rule, SectionTitle, Segmented, Select, Spinner, cx } from "@/components/ui";
import { api } from "@/lib/api";
import { date, eur, pct, relative } from "@/lib/format";
import type { GeoCollection, MarketOverview } from "@/lib/types";

const VENETO = ["padova", "vicenza", "treviso", "venezia", "rovigo"];
const THRESHOLD = 35;

function Kpi({ label, value, sub, hero, tone }: { label: string; value: string; sub?: string; hero?: boolean; tone?: "gold" | "ok" | "bad" }) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">{label}</p>
      <p
        className={cx(
          "mt-2 leading-none tracking-[-0.02em]",
          hero ? "text-[52px] font-light" : "text-[30px] font-light",
          tone === "gold" ? "text-gold" : tone === "ok" ? "text-ok" : tone === "bad" ? "text-bad" : "text-ink",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-2 text-[12.5px] leading-snug text-muted">{sub}</p>}
    </div>
  );
}

function quarterName(q: string): string {
  return `${q.slice(-1)}° trimestre ${q.slice(0, 4)}`;
}

export default function Mercato() {
  const [params, setParams] = useSearchParams();
  const segment = params.get("segmento") ?? "residenziale";
  const area = params.get("area") ?? "padova";
  const navigate = useNavigate();
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    p.set(k, v);
    setParams(p, { replace: true });
  };

  const ov = useQuery({
    queryKey: ["market", segment, area],
    queryFn: () => api<MarketOverview>(`/analytics/overview?segment=${segment}&area=${area}`),
    placeholderData: (prev) => prev,
  });
  const zones = useZones(segment);
  const opps = useQuery({
    queryKey: ["geo-opp", segment],
    queryFn: () => api<GeoCollection>(`/lotti/geojson?status=active&opportunity=true&segment=${segment}`),
    staleTime: 60_000,
  });
  const breaks = useMemo(() => quantileBreaks(zones.data?.features.map((f) => f.properties.median) ?? []), [zones.data]);
  const d = ov.data;
  const k = d?.kpis;

  const index = d?.index ?? [];
  const hasTrend = (d?.comuni ?? []).some((c) => c.trend != null);
  // consecutive quarters PVP left (almost) empty, drawn as a band instead of a line across them
  const gaps = useMemo(() => {
    const out: XBand[] = [];
    (d?.index ?? []).forEach((p, i) => {
      if (!p.gap) return;
      const last = out[out.length - 1];
      if (last && last.to === i - 1) last.to = i;
      else out.push({ from: i, to: i, label: "Nessun dato dal PVP" });
    });
    return out;
  }, [d]);
  const gap = k?.stima_median && k.asta_median ? (1 - k.asta_median / k.stima_median) * 100 : null;

  return (
    <Page
      wide
      title="Mercato"
      subtitle="Quanto valgono gli immobili zona per zona secondo le perizie dei tribunali, come si muovono i prezzi delle aste nel tempo e dove il prezzo di oggi è sensibilmente sotto il valore della zona."
    >
      {/* one row of controls, scoping everything below */}
      <div className="mb-14 flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
        <Segmented value={segment} onChange={(v) => set("segmento", v)} options={Object.entries(d?.segments ?? { residenziale: "Residenziale" }).map(([value, label]) => ({ value, label }))} />
        <div className="flex items-center gap-4">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">Area</span>
          <Select value={area} onChange={(e) => set("area", e.target.value)} className="!w-56">
            <option value="IT">Italia</option>
            <optgroup label="Veneto">
              {(d?.provinces ?? []).filter((p) => VENETO.includes(p.key)).map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Altre province">
              {(d?.provinces ?? []).filter((p) => !VENETO.includes(p.key)).map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          </Select>
        </div>
      </div>

      {!d ? (
        <div className="grid place-items-center py-24">
          <Spinner />
        </div>
      ) : (
        <div className={cx("transition-opacity", ov.isFetching && "opacity-60")}>
          {/* headline figures */}
          <div className="grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <Kpi hero label="Valore di perizia" value={fmtEurMq(k?.stima_median)} sub={k?.stima_n ? `mediana di ${k.stima_n.toLocaleString("it-IT")} perizie, ultimi sei anni` : "dati insufficienti"} />
            <Kpi label="In asta oggi" value={fmtEurMq(k?.asta_median)} sub={gap !== null ? `${pct(gap)} sotto il valore di perizia` : `${k?.n_active ?? 0} immobili in asta`} />
            <Kpi
              label="Forbice di zona"
              value={k?.stima_p25 && k.stima_p75 ? `${Math.round(k.stima_p25).toLocaleString("it-IT")}–${Math.round(k.stima_p75).toLocaleString("it-IT")}` : "—"}
              sub={
                k?.trend_pct != null
                  ? `€/m², metà delle perizie · ${k.trend_pct > 0 ? "+" : ""}${k.trend_pct.toLocaleString("it-IT")}% sui 12 mesi`
                  : "€/m², la metà centrale delle perizie"
              }
            />
            <Kpi tone="gold" label="Opportunità" value={String(k?.n_opportunities ?? 0)} sub={`su ${k?.n_benchmarked ?? 0} immobili con prezzo al m²`} />
          </div>

          <Rule className="my-16" />

          {/* prices over time */}
          <section>
            <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
              <div>
                <h2 className="font-serif text-[26px] text-ink">Prezzi nel tempo</h2>
                <p className="mt-1 text-[13.5px] text-muted">Prezzo al m², mediana mobile sugli ultimi 12 mesi, {d.area.label}.</p>
              </div>
              <Legend
                items={[
                  { label: "Valore di perizia (primo esperimento)", color: "var(--viz-appraisal)" },
                  { label: "Prezzo base d'asta (tutti gli esperimenti)", color: "var(--viz-auction)" },
                ]}
              />
            </div>
            {index.length < 2 ? (
              <p className="py-10 text-[13.5px] text-faint">Storico insufficiente per quest'area.</p>
            ) : (
              <>
                <LineChart
                  labels={index.map((p) => p.quarter)}
                  series={[
                    { key: "stima", label: "perizia", color: "var(--viz-appraisal)", values: index.map((p) => p.stima) },
                    { key: "asta", label: "base d'asta", color: "var(--viz-auction)", values: index.map((p) => p.asta) },
                  ]}
                  bands={gaps}
                />
                <p className="mt-8 mb-2 text-[12px] text-muted">Esperimenti d'asta per trimestre</p>
                <Columns
                  labels={index.map((p) => p.quarter)}
                  values={index.map((p) => p.n_aste)}
                  tooltipLabel={(i) => `${index[i]!.quarter.replace("-Q", " · trimestre ")} · ${index[i]!.n_deserte} deserte`}
                  bands={gaps}
                />
                {gaps.length > 0 && (
                  <p className="mt-5 max-w-3xl text-[12.5px] leading-relaxed text-faint">
                    Dal {quarterName(index[gaps[0]!.from]!.quarter)} al {quarterName(index[gaps[gaps.length - 1]!.to]!.quarter)} il Portale delle
                    Vendite Pubbliche non restituisce quasi nessuna vendita. Il grafico lascia vuoto quel periodo invece di unire i punti, e le aste
                    pubblicate nei dodici mesi successivi non vengono usate come perizie: potrebbero essere ribassi di esperimenti che non vediamo.
                    La linea della perizia riprende quando il dato torna affidabile.
                  </p>
                )}
                <div className="mt-4">
                  <TableToggle>
                    <table className="num w-full text-[12.5px]">
                      <thead className="text-left text-faint">
                        <tr>
                          <th className="pb-2 font-medium">Trimestre</th>
                          <th className="pb-2 text-right font-medium">Perizia €/m²</th>
                          <th className="pb-2 text-right font-medium">Base d'asta €/m²</th>
                          <th className="pb-2 text-right font-medium">Esperimenti</th>
                          <th className="pb-2 text-right font-medium">Deserte</th>
                        </tr>
                      </thead>
                      <tbody>
                        {index.filter((p) => p.gap || p.stima !== null || p.asta !== null || p.n_aste > 0).map((p) => (
                          <tr key={p.quarter} className="border-t border-line">
                            <td className="py-1.5">{p.quarter}</td>
                            <td className="py-1.5 text-right">{p.stima ? Math.round(p.stima).toLocaleString("it-IT") : "—"}</td>
                            <td className="py-1.5 text-right">{p.asta ? Math.round(p.asta).toLocaleString("it-IT") : "—"}</td>
                            <td className="py-1.5 text-right">{p.n_aste}</td>
                            <td className="py-1.5 text-right">{p.n_deserte}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableToggle>
                </div>
              </>
            )}
          </section>

          <Rule className="my-16" />

          {/* where prices sit today */}
          <section className="grid gap-14 lg:grid-cols-2">
            <div>
              <h2 className="font-serif text-[26px] text-ink">Prezzo rispetto alla zona</h2>
              <p className="mt-1 mb-6 text-[13.5px] text-muted">
                Immobili in asta per sconto sul valore di perizia della loro zona. In oro le opportunità: oltre il {THRESHOLD}% sotto le perizie,
                oltre il 25% sotto le aste della zona e con una perizia in linea con la zona.
              </p>
              <Columns
                height={220}
                labels={d.histogram.map((b) => `${b.from}%`)}
                labelAt="edge"
                values={d.histogram.map((b) => b.n)}
                highlight={d.histogram.map((b) => b.opp)}
                tooltipLabel={(i) => {
                  const b = d.histogram[i]!;
                  const range = `${b.from >= 0 ? `${b.from}–${b.to}% sotto` : b.to <= 0 ? `${-b.to}–${-b.from}% sopra` : "in linea"}`;
                  return `${range} · ${b.opp} opportunità`;
                }}
                marker={{ index: (THRESHOLD - (d.histogram[0]?.from ?? 0)) / 10, label: `soglia ${THRESHOLD}%` }}
              />
              <div className="mt-2 flex items-center justify-between text-[11px] text-faint">
                <span>← sopra il valore di zona</span>
                <Legend
                  items={[
                    { label: "Opportunità", color: "var(--viz-opportunity)", kind: "rect" },
                    { label: "Altri immobili", color: "var(--viz-context)", kind: "rect" },
                  ]}
                />
                <span>sconto sulla zona →</span>
              </div>
            </div>
            <div>
              <h2 className="font-serif text-[26px] text-ink">Ogni immobile, ogni zona</h2>
              <p className="mt-1 mb-4 text-[13.5px] text-muted">Prezzo al m² di oggi contro il valore di perizia della zona. Sotto la linea tratteggiata, oltre il {THRESHOLD}% di sconto.</p>
              <Legend
                items={[
                  { label: "Opportunità", color: "var(--viz-opportunity)", kind: "dot" },
                  { label: "Altri immobili in asta", color: "var(--viz-context)", kind: "dot" },
                ]}
              />
              <div className="mt-3">
                <Scatter
                  points={d.scatter.filter((p) => p.x && p.y).map((p) => ({ id: p.id, x: p.x!, y: p.y!, highlight: p.o, label: p.t }))}
                  threshold={THRESHOLD}
                  onSelect={(id) => navigate(`/lotti/${id}`)}
                />
              </div>
            </div>
          </section>

          <Rule className="my-16" />

          {/* the map of values */}
          <section>
            <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
              <div>
                <h2 className="font-serif text-[26px] text-ink">Mappa dei valori</h2>
                <p className="mt-1 text-[13.5px] text-muted">Valore di perizia al m² per celle di circa due chilometri. Gli anelli d'oro sono le opportunità.</p>
              </div>
              <Link to={`/?opportunity=true&segment=${segment}&status=active`} className="group inline-flex items-center gap-1 text-[13px] font-medium text-gold">
                <span className="underline decoration-transparent underline-offset-[5px] group-hover:decoration-current/40">Apri sulla mappa principale</span>
                <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
            <div className="relative h-[520px] overflow-hidden rounded-lg">
              <MapView
                data={opps.data}
                hoveredId={null}
                selectedId={null}
                onHover={() => {}}
                onSelect={(id) => navigate(`/lotti/${id}`)}
                onBoundsChange={() => {}}
                drawing={false}
                polygon={undefined}
                onPolygon={() => {}}
                onDrawingEnd={() => {}}
                initialView={area === "IT" ? "italy" : "veneto"}
                zones={zones.data}
                zoneBreaks={breaks}
              />
              <div className="absolute top-3 left-3 z-10">
                <MapLegend zoneBreaks={breaks} />
              </div>
            </div>
          </section>

          <Rule className="my-16" />

          {/* opportunities */}
          <section>
            <SectionTitle
              action={
                <Link to={`/?opportunity=true&segment=${segment}&status=active&sort=opportunita`} className="text-[13px] font-medium text-gold">
                  Tutte sulla mappa
                </Link>
              }
            >
              Opportunità · {d.area.label}
            </SectionTitle>
            {d.opportunities.length === 0 ? (
              <p className="py-6 text-[13.5px] text-faint">Nessun immobile supera oggi entrambe le soglie in quest'area.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.opportunities.map((o, i) => (
                  <motion.li key={o.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.03 }}>
                    <Link to={`/lotti/${o.id}`} className="group grid grid-cols-[64px_1fr_auto] items-center gap-5 py-4 sm:grid-cols-[64px_1fr_repeat(3,minmax(110px,auto))]">
                      <Thumb url={o.cover_url} category={null} className="size-16" />
                      <div className="min-w-0">
                        <p className="truncate font-serif text-[17px] text-ink transition-colors group-hover:text-gold">{o.titolo}</p>
                        <p className="truncate text-[12.5px] text-muted">
                          {[o.zona_label, o.n_rounds > 1 ? `${o.n_rounds}° esperimento` : null, o.termine_offerte ? `offerte entro il ${date(o.termine_offerte)}` : o.data_vendita ? `vendita ${date(o.data_vendita)}` : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <div className="hidden text-right sm:block">
                        <p className="num text-[14px] text-ink">{eur(o.prezzo_base)}</p>
                        <p className="num text-[11.5px] text-faint">{o.superficie_mq ? `${Math.round(o.superficie_mq)} m²` : ""}</p>
                      </div>
                      <div className="hidden text-right sm:block">
                        <p className="num text-[14px] text-ink">{fmtEurMq(o.eur_mq)}</p>
                        <p className="num text-[11.5px] text-faint">zona {fmtEurMq(o.zona_eur_mq)}</p>
                      </div>
                      <div className="text-right">
                        <p className="num text-[20px] font-light text-gold">−{pct(o.sconto_zona_pct)}</p>
                        <p className="text-[11.5px] text-faint">sulla zona</p>
                      </div>
                    </Link>
                  </motion.li>
                ))}
              </ul>
            )}
          </section>

          <Rule className="my-16" />

          {/* comuni table */}
          <section>
            <SectionTitle>Valori per comune · {d.area.label}</SectionTitle>
            <div className="overflow-x-auto">
              <table className="num w-full min-w-[720px] text-[13.5px]">
                <thead>
                  <tr className="text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">
                    <th className="pb-3">Comune</th>
                    <th className="pb-3 text-right">Perizie</th>
                    <th className="pb-3 text-right">Valore di perizia</th>
                    <th className="pb-3 text-right">Fascia centrale</th>
                    <th className="pb-3 text-right">In asta oggi</th>
                    {hasTrend && <th className="pb-3 text-right">12 mesi</th>}
                    <th className="pb-3 text-right">Opportunità</th>
                  </tr>
                </thead>
                <tbody>
                  {d.comuni.map((c) => (
                    <tr key={c.key} className="border-t border-line">
                      <td className="py-2.5 text-ink">{c.label}</td>
                      <td className="py-2.5 text-right text-muted">{c.n}</td>
                      <td className="py-2.5 text-right text-ink">{fmtEurMq(c.median)}</td>
                      <td className="py-2.5 text-right text-muted">
                        {Math.round(c.p25).toLocaleString("it-IT")}–{Math.round(c.p75).toLocaleString("it-IT")}
                      </td>
                      <td className="py-2.5 text-right text-muted">{c.asta ? fmtEurMq(c.asta) : "—"}</td>
                      {hasTrend && (
                        <td className={cx("py-2.5 text-right", c.trend == null ? "text-faint" : c.trend >= 0 ? "text-ink" : "text-muted")}>
                          {c.trend == null ? "—" : `${c.trend > 0 ? "+" : ""}${c.trend.toLocaleString("it-IT")}%`}
                        </td>
                      )}
                      <td className={cx("py-2.5 text-right", c.n_opp ? "font-semibold text-gold" : "text-faint")}>{c.n_opp || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="mt-16 max-w-3xl text-[12px] leading-relaxed text-faint">
            Metodo. In un'asta giudiziaria il prezzo base del primo esperimento è la stima del perito: diviso la superficie dà un valore di perizia
            al m². Per ogni zona (celle di circa 2 km, poi comune, poi celle di circa 8 km, finché ci sono abbastanza perizie comparabili) si prende la mediana
            delle perizie degli ultimi sei anni dello stesso segmento. Le superfici vengono dal dettaglio PVP o, se assente, dalla descrizione
            dell'annuncio; quote e diritti parziali sono esclusi. I valori descrivono il mercato delle aste, non il mercato libero.
            {d.computed_at && ` Aggiornato ${relative(d.computed_at)}.`}
          </p>
        </div>
      )}
    </Page>
  );
}
