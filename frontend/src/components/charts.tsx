// Small SVG charts, built to the dataviz rules: one axis, 2px lines, <=24px bars with 4px
// rounded data-ends, hairline grid, tooltips on hover/focus, legend for 2+ series, table view.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e!.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const compact = new Intl.NumberFormat("it-IT", { notation: "compact", maximumFractionDigits: 1 });
const int = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
export const fmtEurMq = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `€ ${int.format(Math.round(v))}/m²`);

function niceTicks(min: number, max: number, count = 4): number[] {
  if (max <= min) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  // always end on a tick at or above the maximum, so no mark is ever clipped
  for (let v = start; ; v += step) {
    out.push(Math.round(v * 100) / 100);
    if (v >= max - step * 0.001) break;
  }
  return out;
}

function Tooltip({ x, y, w, children }: { x: number; y: number; w: number; children: ReactNode }) {
  const left = Math.min(Math.max(x + 14, 0), w - 200);
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-[160px] rounded-md bg-surface px-3 py-2 text-[12px] shadow-float"
      style={{ left, top: Math.max(0, y - 10) }}
      role="status"
    >
      {children}
    </div>
  );
}

function KeyLine({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <svg width="16" height="6" className="shrink-0" aria-hidden>
      <line x1="0" y1="3" x2="16" y2="3" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray={dashed ? "3 3" : undefined} />
    </svg>
  );
}

export function Legend({ items }: { items: { label: string; color: string; kind?: "line" | "dot" | "rect"; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.kind === "dot" ? (
            <span className="size-2 rounded-full" style={{ background: i.color }} />
          ) : i.kind === "rect" ? (
            <span className="h-2 w-2.5 rounded-[2px]" style={{ background: i.color }} />
          ) : (
            <KeyLine color={i.color} dashed={i.dashed} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ line chart

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
}

/** a stretch of the x axis with no data on purpose (e.g. the PVP coverage hole), indices inclusive */
export interface XBand {
  from: number;
  to: number;
  label: string;
}

function BandRect({ x0, x1, top, height, label }: { x0: number; x1: number; top: number; height: number; label: string }) {
  if (x1 <= x0) return null;
  return (
    <g aria-label={label}>
      <rect x={x0} y={top} width={x1 - x0} height={height} fill="var(--viz-grid)" opacity="0.55" />
      {x1 - x0 > 60 && (
        <text x={(x0 + x1) / 2} y={top + 14} textAnchor="middle" className="fill-faint text-[10.5px]">
          {label}
        </text>
      )}
    </g>
  );
}

export function LineChart({
  labels,
  series,
  height = 260,
  format = fmtEurMq,
  bands = [],
}: {
  labels: string[];
  series: LineSeries[];
  height?: number;
  format?: (v: number | null) => string;
  bands?: XBand[];
}) {
  const [ref, w] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 52, r: 86, t: 12, b: 26 };
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const lo = all.length ? Math.min(...all) : 0;
  const hi = all.length ? Math.max(...all) : 1;
  const ticks = niceTicks(Math.max(0, lo - (hi - lo) * 0.1), hi + (hi - lo) * 0.05);
  const y0 = ticks[0]!;
  const y1 = ticks[ticks.length - 1]!;
  const iw = Math.max(10, w - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (labels.length <= 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih;
  const every = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(iw / 70))));

  const paths = series.map((s) => {
    let d = "";
    let pen = false;
    s.values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  });

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      {w > 0 && (
        <svg
          width={w}
          height={height}
          className="block"
          role="img"
          aria-label={series.map((s) => s.label).join(" e ")}
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = e.clientX - r.left;
            const i = Math.round(((px - pad.l) / iw) * (labels.length - 1));
            setHover(Math.min(labels.length - 1, Math.max(0, i)));
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={pad.l + iw} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth="1" />
              <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="num fill-faint text-[10.5px]">
                {compact.format(t)}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            i % every === 0 ? (
              <text key={l} x={x(i)} y={height - 6} textAnchor="middle" className="fill-faint text-[10.5px]">
                {l.replace("-Q", " T")}
              </text>
            ) : null,
          )}
          {bands.map((b) => {
            const half = labels.length > 1 ? iw / (labels.length - 1) / 2 : 0;
            return (
              <BandRect
                key={b.from}
                x0={Math.max(pad.l, x(b.from) - half)}
                x1={Math.min(pad.l + iw, x(b.to) + half)}
                top={pad.t}
                height={ih}
                label={b.label}
              />
            );
          })}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--viz-axis)" strokeWidth="1" />}
          {series.map((s, si) => (
            <path key={s.key} d={paths[si]} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {series.map((s) => {
            const lastI = s.values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop();
            if (lastI === undefined) return null;
            const v = s.values[lastI]!;
            return (
              <g key={s.key}>
                <circle cx={x(lastI)} cy={y(v)} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="2" />
                <text x={x(lastI) + 9} y={y(v)} dy="0.32em" className="num fill-ink text-[11px] font-medium">
                  {compact.format(Math.round(v))}
                </text>
              </g>
            );
          })}
          {hover !== null &&
            series.map((s) => {
              const v = s.values[hover];
              return v === null || v === undefined ? null : (
                <circle key={s.key} cx={x(hover)} cy={y(v)} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="2" />
              );
            })}
        </svg>
      )}
      {hover !== null && w > 0 && (
        <Tooltip x={x(hover)} y={pad.t} w={w}>
          <p className="mb-1 text-[11px] text-faint">{labels[hover]?.replace("-Q", " · trimestre ")}</p>
          {bands.some((b) => hover >= b.from && hover <= b.to) && (
            <p className="mb-1 text-[11px] text-muted">{bands.find((b) => hover >= b.from && hover <= b.to)!.label}</p>
          )}
          {series.map((s) => (
            <p key={s.key} className="flex items-center gap-2">
              <KeyLine color={s.color} />
              <span className="num font-semibold text-ink">{format(s.values[hover] ?? null)}</span>
              <span className="text-muted">{s.label}</span>
            </p>
          ))}
        </Tooltip>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ columns

export function Columns({
  labels,
  values,
  color = "var(--viz-context)",
  colors,
  height = 120,
  format = (v: number) => int.format(v),
  tooltipLabel,
  marker,
  highlight,
  highlightColor = "var(--viz-opportunity)",
  bands = [],
  labelAt = "center",
}: {
  labels: string[];
  values: number[];
  /** "edge": each label marks where its bar's bin starts (histograms) */
  labelAt?: "center" | "edge";
  /** part of each value drawn at the base of the bar in the highlight colour (stacked, 2px gap) */
  highlight?: number[];
  highlightColor?: string;
  color?: string;
  colors?: string[];
  height?: number;
  format?: (v: number) => string;
  tooltipLabel?: (i: number) => ReactNode;
  marker?: { index: number; label: string };
  bands?: XBand[];
}) {
  const [ref, w] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 52, r: 86, t: 16, b: 22 };
  const iw = Math.max(10, w - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const max = Math.max(1, ...values);
  const ticks = niceTicks(0, max, 2);
  const top = ticks[ticks.length - 1]!;
  const band = iw / Math.max(1, values.length);
  const bw = Math.min(24, Math.max(3, band - 2));
  const every = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(iw / 70))));
  const y = (v: number) => pad.t + ih - (v / top) * ih;

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      {w > 0 && (
        <svg width={w} height={height} className="block" role="img">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={pad.l + iw} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth="1" />
              <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="num fill-faint text-[10.5px]">
                {compact.format(t)}
              </text>
            </g>
          ))}
          {bands.map((b) => (
            <BandRect key={b.from} x0={pad.l + band * b.from} x1={pad.l + band * (b.to + 1)} top={pad.t} height={ih} label={b.label} />
          ))}
          {values.map((v, i) => {
            const cx0 = pad.l + band * i + band / 2;
            const h = Math.max(0, pad.t + ih - y(v));
            const r = Math.min(4, h, bw / 2);
            const x0 = cx0 - bw / 2;
            const yTop = pad.t + ih - h;
            // square at the baseline, 4px rounded data-end
            const d = `M${x0},${pad.t + ih}V${yTop + r}Q${x0},${yTop} ${x0 + r},${yTop}H${x0 + bw - r}Q${x0 + bw},${yTop} ${x0 + bw},${yTop + r}V${pad.t + ih}Z`;
            const hv = highlight?.[i] ?? 0;
            const hh = hv > 0 ? Math.max(2, pad.t + ih - y(hv)) : 0;
            const allHighlighted = hv > 0 && hv >= v;
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} className="outline-none">
                <rect x={pad.l + band * i} y={pad.t} width={band} height={ih} fill="transparent" />
                {h > 0 && (
                  <path d={d} fill={allHighlighted ? highlightColor : (colors?.[i] ?? color)} opacity={hover === null || hover === i ? 1 : 0.55} />
                )}
                {hh > 0 && !allHighlighted && (
                  <>
                    <rect x={x0} y={pad.t + ih - hh - 2} width={bw} height={2} fill="var(--surface)" />
                    <rect x={x0} y={pad.t + ih - hh} width={bw} height={hh} fill={highlightColor} opacity={hover === null || hover === i ? 1 : 0.55} />
                  </>
                )}
                {i % every === 0 && (
                  <text x={labelAt === "edge" ? pad.l + band * i : cx0} y={height - 6} textAnchor="middle" className="fill-faint text-[10.5px]">
                    {labels[i]?.replace("-Q", " T")}
                  </text>
                )}
              </g>
            );
          })}
          {marker && (
            <g>
              <line
                x1={pad.l + band * marker.index}
                x2={pad.l + band * marker.index}
                y1={pad.t - 6}
                y2={pad.t + ih}
                stroke="var(--viz-opportunity)"
                strokeWidth="1"
              />
              <text x={pad.l + band * marker.index + 6} y={pad.t - 2} className="fill-ink text-[11px] font-medium">
                {marker.label}
              </text>
            </g>
          )}
        </svg>
      )}
      {hover !== null && w > 0 && (
        <Tooltip x={pad.l + band * hover + band / 2} y={y(values[hover] ?? 0) - 40} w={w}>
          <p className="num font-semibold text-ink">{format(values[hover] ?? 0)}</p>
          <p className="text-muted">{tooltipLabel ? tooltipLabel(hover) : labels[hover]}</p>
        </Tooltip>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ scatter

export interface ScatterPoint {
  id: number;
  x: number;
  y: number;
  highlight: boolean;
  label: string;
}

export function Scatter({
  points,
  threshold,
  onSelect,
  height = 320,
}: {
  points: ScatterPoint[];
  threshold: number;
  onSelect?: (id: number) => void;
  height?: number;
}) {
  const [ref, w] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<ScatterPoint | null>(null);
  const pad = { l: 52, r: 20, t: 14, b: 34 };
  const iw = Math.max(10, w - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const { xmax, ymax } = useMemo(() => {
    const xs = points.map((p) => p.x).sort((a, b) => a - b);
    const ys = points.map((p) => p.y).sort((a, b) => a - b);
    const q = (arr: number[]) => arr[Math.floor(arr.length * 0.98)] ?? 1;
    return { xmax: q(xs) * 1.08, ymax: q(ys) * 1.08 };
  }, [points]);
  const m = Math.max(xmax, ymax);
  const xt = niceTicks(0, m, 4);
  const top = xt[xt.length - 1]!;
  const X = (v: number) => pad.l + (Math.min(v, top) / top) * iw;
  const Y = (v: number) => pad.t + ih - (Math.min(v, top) / top) * ih;
  const ordered = [...points].sort((a, b) => Number(a.highlight) - Number(b.highlight));

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      {w > 0 && (
        <svg
          width={w}
          height={height}
          className="block"
          role="img"
          aria-label="Prezzo al metro quadro di ogni immobile rispetto al valore della sua zona"
          onMouseMove={(e) => {
            // nearest point within 24px: the pointer only has to be closest, not dead-centre
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = e.clientX - r.left;
            const py = e.clientY - r.top;
            let best: ScatterPoint | null = null;
            let bd = 24 * 24;
            for (const p of points) {
              const d = (X(p.x) - px) ** 2 + (Y(p.y) - py) ** 2;
              if (d < bd) {
                bd = d;
                best = p;
              }
            }
            setHover(best);
          }}
          onClick={() => hover && onSelect?.(hover.id)}
          style={{ cursor: hover && onSelect ? "pointer" : "default" }}
        >
          {xt.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={pad.l + iw} y1={Y(t)} y2={Y(t)} stroke="var(--viz-grid)" strokeWidth="1" />
              <text x={pad.l - 8} y={Y(t)} dy="0.32em" textAnchor="end" className="num fill-faint text-[10.5px]">
                {compact.format(t)}
              </text>
              <text x={X(t)} y={pad.t + ih + 16} textAnchor="middle" className="num fill-faint text-[10.5px]">
                {compact.format(t)}
              </text>
            </g>
          ))}
          <text x={pad.l + iw} y={height - 2} textAnchor="end" className="fill-faint text-[10.5px]">
            Valore di zona, €/m² →
          </text>
          {/* parity and threshold */}
          <line x1={X(0)} y1={Y(0)} x2={X(top)} y2={Y(top)} stroke="var(--viz-axis)" strokeWidth="1" />
          <line x1={X(0)} y1={Y(0)} x2={X(top)} y2={Y(top * (1 - threshold / 100))} stroke="var(--viz-opportunity)" strokeWidth="1" strokeDasharray="4 4" />
          <text x={X(top) - 4} y={Y(top) + 14} textAnchor="end" className="fill-muted text-[10.5px]">
            pari al valore di zona
          </text>
          <text x={X(top) - 4} y={Y(top * (1 - threshold / 100)) + 14} textAnchor="end" className="fill-ink text-[10.5px] font-medium">
            −{threshold}%: soglia opportunità
          </text>
          {ordered.map((p) => (
            <circle
              key={p.id}
              cx={X(p.x)}
              cy={Y(p.y)}
              r={hover?.id === p.id ? 6 : 4}
              fill={p.highlight ? "var(--viz-opportunity)" : "var(--viz-context)"}
              stroke="var(--surface)"
              strokeWidth="2"
              opacity={p.highlight ? 1 : 0.8}
            />
          ))}
        </svg>
      )}
      {hover && w > 0 && (
        <Tooltip x={X(hover.x)} y={Y(hover.y) - 60} w={w}>
          <p className="num font-semibold text-ink">{fmtEurMq(hover.y)}</p>
          <p className="text-muted">zona {fmtEurMq(hover.x)}</p>
          <p className="mt-1 max-w-[220px] truncate text-ink">{hover.label}</p>
          {onSelect && <p className="text-[11px] text-faint">Clic per aprire la scheda</p>}
        </Tooltip>
      )}
    </div>
  );
}

/** "Tabella" text toggle that reveals the data behind a chart. */
export function TableToggle({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} className={cx("cursor-pointer text-[12px] transition-colors", open ? "text-ink" : "text-faint hover:text-ink")}>
        {open ? "Nascondi tabella" : "Mostra tabella"}
      </button>
      {open && <div className="mt-3 max-h-72 overflow-auto">{children}</div>}
    </div>
  );
}
