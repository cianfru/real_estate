import { useNavigate } from "react-router-dom";
import { eur, pct } from "@/lib/format";
import type { LottoDetail } from "@/lib/types";
import { fmtEurMq, useSize } from "./charts";
import { SectionTitle, cx } from "./ui";

const LEVEL: Record<string, string> = {
  hex: "nel raggio di circa un chilometro",
  comune: "nel comune",
  hexL: "nel raggio di qualche chilometro",
  provincia: "nella provincia",
};

/** Where the lot's price per m² sits against the appraised values of its zone. */
type ValuationLot = Pick<LottoDetail, "eur_mq" | "eur_mq_stima" | "zona" | "sconto_zona_pct" | "opportunity" | "superficie_mq"> &
  Partial<Pick<LottoDetail, "comparables" | "quota_parziale" | "superficie_source" | "sconto_aste_pct">>;

export function AreaValuation({ lot }: { lot: ValuationLot }) {
  const navigate = useNavigate();
  const z = lot.zona;
  if (!lot.superficie_mq) {
    return (
      <Section>
        <p className="text-[13.5px] text-muted">Superficie non indicata su PVP: non è possibile calcolare il prezzo al metro quadro.</p>
      </Section>
    );
  }
  if (!lot.eur_mq) return null;
  const s = lot.sconto_zona_pct;
  const stimaVsZona = z && lot.eur_mq_stima ? (lot.eur_mq_stima / z.eur_mq - 1) * 100 : null;
  return (
    <Section>
      {z && s !== null ? (
        <p className={cx("font-serif text-[30px] leading-tight tracking-tight", lot.opportunity ? "text-gold" : "text-ink")}>
          {s >= 0 ? `${pct(s)} sotto` : `${pct(-s)} sopra`} il valore di zona
        </p>
      ) : (
        <p className="font-serif text-[22px] text-ink">Valore di zona non disponibile</p>
      )}
      <p className="mt-2 max-w-[60ch] text-[13.5px] leading-relaxed text-muted">
        {z ? (
          <>
            Oggi in asta a <span className="num text-ink">{fmtEurMq(lot.eur_mq)}</span>. Gli immobili dello stesso tipo{" "}
            {z.level === "comune" && z.label ? `a ${z.label}` : z.level === "provincia" && z.label ? `in ${z.label.replace("Provincia", "provincia")}` : LEVEL[z.level]} sono
            stati stimati dai periti{" "}
            <span className="num text-ink">{fmtEurMq(z.eur_mq)}</span> in mediana, su {z.n} perizie.
            {stimaVsZona !== null && Math.abs(stimaVsZona) >= 10 && (
              <>
                {" "}
                La perizia di questo immobile era {stimaVsZona < 0 ? "già" : ""} {pct(Math.abs(stimaVsZona))} {stimaVsZona < 0 ? "sotto" : "sopra"} la zona
                {stimaVsZona < -20 ? ": verificare stato e conformità." : "."}
              </>
            )}
          </>
        ) : (
          <>Troppo pochi immobili comparabili nella zona per una stima affidabile.</>
        )}
      </p>
      {z?.level === "provincia" && (
        <p className="mt-2 text-[13px] text-muted">Confronto su base provinciale: troppo pochi comparabili vicini per un giudizio più fine.</p>
      )}
      {lot.quota_parziale && (
        <p className="mt-2 text-[13px] text-warn">Vendita di una quota o di un diritto parziale: il prezzo al m² non è confrontabile.</p>
      )}

      {z && (
        <div className="mt-7 grid grid-cols-3 gap-6 border-t border-line pt-5">
          <Fig label="Oggi in asta" value={fmtEurMq(lot.eur_mq)} strong={lot.opportunity} />
          <Fig label="Perizie della zona" value={fmtEurMq(z.eur_mq)} sub={`mediana di ${z.n}`} />
          <Fig
            label="Aste della zona"
            value={fmtEurMq(z.asta_eur_mq)}
            sub={lot.sconto_aste_pct != null ? `${lot.sconto_aste_pct >= 0 ? pct(lot.sconto_aste_pct) + " sotto" : pct(-lot.sconto_aste_pct) + " sopra"}` : undefined}
          />
        </div>
      )}

      {z && z.p25 !== null && z.p75 !== null && <RangeBar lot={lot.eur_mq} stima={lot.eur_mq_stima} median={z.eur_mq} p25={z.p25} p75={z.p75} opp={lot.opportunity} />}

      {lot.comparables && lot.comparables.length > 0 && (
        <div className="mt-8">
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">Nelle vicinanze</p>
          <table className="w-full text-[13px]">
            <tbody>
              {lot.comparables.map((c) => (
                <tr key={c.id} onClick={() => navigate(`/lotti/${c.id}`)} className="cursor-pointer border-t border-line transition-colors hover:text-gold">
                  <td className="py-2 pr-3">
                    <span className={cx("block truncate", c.opportunity ? "text-gold" : "text-ink")}>{c.titolo}</span>
                    <span className="text-[11.5px] text-faint">
                      {c.distance_km.toLocaleString("it-IT")} km · {c.status === "active" ? "in asta" : "concluso"}
                    </span>
                  </td>
                  <td className="num py-2 pr-3 text-right text-muted">{eur(c.prezzo_base)}</td>
                  <td className="num py-2 text-right text-ink">{fmtEurMq(c.eur_mq)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-6 max-w-[70ch] text-[11.5px] leading-relaxed text-faint">
        Valore di zona: mediana del prezzo base al primo esperimento (la stima del perito) diviso la superficie, per immobili dello stesso
        segmento messi all'asta negli ultimi sei anni. Aste della zona: mediana del prezzo base al m² di tutti gli esperimenti. È
        un'opportunità quando il prezzo è almeno il 35% sotto le perizie e il 25% sotto le aste della zona, e la perizia dell'immobile è
        in linea con la zona.
        {lot.superficie_source === "testo" && " Superficie ricavata dalla descrizione dell'annuncio."}
      </p>
    </Section>
  );
}

function Fig({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">{label}</p>
      <p className={cx("num mt-1 text-[16px]", strong ? "font-semibold text-gold" : "text-ink")}>{value}</p>
      {sub && <p className="text-[12px] text-muted">{sub}</p>}
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section className="px-8 pt-10 pb-2">
      <SectionTitle>Valore di zona</SectionTitle>
      {children}
    </section>
  );
}

function RangeBar({ lot, stima, median, p25, p75, opp }: { lot: number; stima: number | null; median: number; p25: number; p75: number; opp: boolean }) {
  const [ref, w] = useSize<HTMLDivElement>();
  const vals = [lot, median, p25, p75, ...(stima ? [stima] : [])];
  const lo = Math.min(...vals) * 0.85;
  const hi = Math.max(...vals) * 1.08;
  const X = (v: number) => 8 + ((v - lo) / (hi - lo)) * Math.max(10, w - 16);
  const marks: { v: number; label: string; color: string; hollow?: boolean; above: boolean }[] = [
    { v: lot, label: "oggi", color: opp ? "var(--viz-opportunity)" : "var(--text)", above: true },
    ...(stima ? [{ v: stima, label: "perizia", color: "var(--viz-appraisal)", hollow: true, above: false }] : []),
  ];
  return (
    <div ref={ref} className="mt-7">
      {w > 0 && (
        <svg width={w} height={74} overflow="visible" className="block" role="img" aria-label="Prezzo al metro quadro rispetto alla fascia della zona">
          <line x1={8} x2={w - 8} y1={37} y2={37} stroke="var(--viz-grid)" strokeWidth="1" />
          {/* interquartile band of the zone */}
          <rect x={X(p25)} y={31} width={Math.max(2, X(p75) - X(p25))} height={12} rx={2} fill="var(--viz-appraisal)" opacity={0.16} />
          <line x1={X(median)} x2={X(median)} y1={27} y2={47} stroke="var(--viz-appraisal)" strokeWidth="2" />
          <text x={X(median)} y={62} textAnchor="middle" className="num fill-muted text-[10.5px]">
            zona {fmtEurMq(median)}
          </text>
          {marks.map((m) => {
            // keep labels apart: the appraisal label goes below unless it would sit on the zone label
            const nearMedian = Math.abs(X(m.v) - X(median)) < 110;
            const y = m.above ? 15 : nearMedian ? 4 : 62;
            const anchor = X(m.v) < 70 ? "start" : X(m.v) > w - 70 ? "end" : "middle";
            return (
              <g key={m.label}>
                <circle cx={X(m.v)} cy={37} r={5} fill={m.hollow ? "var(--surface)" : m.color} stroke={m.hollow ? m.color : "var(--surface)"} strokeWidth={2} />
                <text x={X(m.v)} y={y} textAnchor={anchor} className={cx("num text-[10.5px]", m.above ? "fill-ink font-medium" : "fill-muted")}>
                  {m.label} {fmtEurMq(m.v)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <p className="text-[11px] text-faint">La fascia indica il 50% centrale delle perizie della zona.</p>
    </div>
  );
}
