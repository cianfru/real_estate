// Building blocks of the property card, shared by the staff card and the public share page.
// Typographic: figures and labels on the page, separated by whitespace and the odd hairline.
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import maplibregl from "maplibre-gl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiUrl } from "@/lib/api";
import type { Allegato, Meta, Round } from "@/lib/types";
import { bytes, countdown, date, dateLong, dateTime, eur, mq, pct } from "@/lib/format";
import { label, useNow, useTheme } from "@/lib/hooks";
import { CATEGORY_COLORS } from "./MapView";
import { SectionTitle, cx } from "./ui";

export interface CardFacts {
  prezzo_base: number | null;
  offerta_minima: number | null;
  rialzo_minimo: number | null;
  valore_stima: number | null;
  sconto_stima_pct?: number | null;
  ribasso_pct?: number | null;
  prezzo_primo_esperimento?: number | null;
  prezzo_mq: number | null;
  termine_offerte: string | null;
  data_vendita: string | null;
  modalita: string | null;
  deposito_cauzionale: string | null;
}

function Figure({ label: l, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "bad" }) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">{l}</p>
      <p className={cx("num mt-1.5 text-[19px] font-medium tracking-tight", tone === "ok" ? "text-ok" : tone === "bad" ? "text-bad" : "text-ink")}>{value}</p>
      {sub && <p className="mt-0.5 text-[12px] leading-snug text-muted">{sub}</p>}
    </div>
  );
}

export function KeyFigures({ d, meta }: { d: CardFacts; meta: Meta | undefined }) {
  const now = useNow(30_000);
  const deadline = d.termine_offerte ?? d.data_vendita;
  const c = countdown(deadline, now);
  const sconto = d.sconto_stima_pct ?? (d.valore_stima && d.prezzo_base ? (1 - d.prezzo_base / d.valore_stima) * 100 : null);
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">Prezzo base</p>
          <p className="num mt-1 text-[44px] font-light leading-none tracking-[-0.02em] text-ink">{eur(d.prezzo_base)}</p>
          <p className="mt-2.5 text-[13px] text-muted">
            {d.offerta_minima ? (
              <>
                Offerta minima <span className="num text-ink">{eur(d.offerta_minima)}</span>
              </>
            ) : null}
            {d.rialzo_minimo ? (
              <>
                <span className="mx-2 text-faint">·</span>Rilancio <span className="num text-ink">{eur(d.rialzo_minimo)}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">{d.termine_offerte ? "Termine offerte" : "Data vendita"}</p>
          {c && !c.past ? (
            <p className={cx("num mt-1 text-[44px] font-light leading-none tracking-[-0.02em]", c.urgent ? "text-bad" : "text-ink")}>
              {c.days > 0 ? (
                <>
                  {c.days}
                  <span className="text-[17px] text-muted"> g </span>
                  {c.hours}
                  <span className="text-[17px] text-muted"> h</span>
                </>
              ) : (
                <>
                  {c.hours}
                  <span className="text-[17px] text-muted"> h </span>
                  {c.minutes}
                  <span className="text-[17px] text-muted"> m</span>
                </>
              )}
            </p>
          ) : (
            <p className="mt-1 text-[24px] font-light leading-none text-muted">Scaduto</p>
          )}
          <p className="mt-2.5 text-[13px] text-muted">{dateTime(deadline)}</p>
        </div>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-6 border-t border-line pt-6 sm:grid-cols-4">
        <Figure
          label="Valore di stima"
          value={d.valore_stima ? eur(d.valore_stima) : "—"}
          sub={sconto ? <span className="text-ok">−{pct(sconto)} sulla stima</span> : "non indicato su PVP"}
        />
        <Figure
          label="Ribasso"
          tone={d.ribasso_pct ? "ok" : undefined}
          value={d.ribasso_pct ? `−${pct(d.ribasso_pct)}` : "—"}
          sub={d.prezzo_primo_esperimento && d.ribasso_pct ? <>dal 1° esperimento, {eur(d.prezzo_primo_esperimento)}</> : "primo esperimento"}
        />
        <Figure label="Prezzo al m²" value={d.prezzo_mq ? eur(d.prezzo_mq) : "—"} sub="sul prezzo base" />
        <Figure label="Vendita" value={<span className="text-[15px]">{label(meta?.modalita, d.modalita)}</span>} sub={d.data_vendita ? dateLong(d.data_vendita) : undefined} />
      </div>
      {d.deposito_cauzionale && <p className="mt-5 text-[12.5px] text-muted">Cauzione {d.deposito_cauzionale}</p>}
    </div>
  );
}

export function RoundTimeline({ rounds, meta }: { rounds: Round[]; meta: Meta | undefined }) {
  if (!rounds.length) return null;
  const max = Math.max(...rounds.map((r) => r.prezzo_base ?? 0)) || 1;
  const ordered = [...rounds].reverse();
  return (
    <section>
      <SectionTitle>Storico esperimenti</SectionTitle>
      <ol>
        {ordered.map((r, i) => (
          <motion.li
            key={r.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="grid grid-cols-[18px_1fr] gap-4 py-3"
          >
            <div className="relative flex justify-center">
              <span className={cx("relative z-10 mt-[7px] size-2 rounded-full", r.is_current ? "bg-gold" : r.esito === "AGGIU" ? "bg-ok" : "bg-faint")} />
              {i < ordered.length - 1 && <span className="absolute top-5 bottom-[-20px] w-px bg-line-strong" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <p className={cx("text-[14px]", r.is_current ? "font-semibold text-ink" : "text-ink/85")}>
                  {r.round_number ? `${r.round_number}° esperimento` : "Esperimento"}
                  <span className="num ml-2 font-normal text-muted">{date(r.data_vendita)}</span>
                </p>
                <p className={cx("num text-[15px]", r.is_current ? "font-semibold text-ink" : "text-ink/85")}>{eur(r.prezzo_base)}</p>
              </div>
              <div className="mt-2 h-px bg-line">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${((r.prezzo_base ?? 0) / max) * 100}%` }}
                  transition={{ duration: 0.7, delay: 0.1 + i * 0.04, ease: [0.22, 1, 0.36, 1] }}
                  className={cx("h-[2px] -translate-y-[0.5px]", r.is_current ? "bg-gold" : "bg-navy/35")}
                />
              </div>
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                {r.drop_pct ? <span className="num text-ok">−{pct(r.drop_pct, 1)}</span> : null}
                {r.is_current && <span className="font-medium text-gold">In corso</span>}
                {r.esito && <span className={r.esito === "AGGIU" ? "text-ok" : ""}>{label(meta?.esiti, r.esito)}</span>}
                {r.modalita && <span className="text-faint">{label(meta?.modalita, r.modalita)}</span>}
                <a href={r.pvp_url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-0.5 text-faint transition-colors hover:text-gold">
                  PVP <ArrowUpRight className="size-3" />
                </a>
              </p>
            </div>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}

export function DetailsGrid({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3">
      {items
        .filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== "—")
        .map(([k, v]) => (
          <div key={k}>
            <dt className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">{k}</dt>
            <dd className="num mt-1 text-[14px] text-ink">{v}</dd>
          </div>
        ))}
    </dl>
  );
}

export function Description({ text }: { text: string | null }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const long = text.length > 420;
  return (
    <div>
      <p className={cx("max-w-[68ch] whitespace-pre-line font-serif text-[16px] leading-[1.65] text-ink/90", !open && long && "line-clamp-5")}>{text}</p>
      {long && (
        <button onClick={() => setOpen(!open)} className="mt-2 cursor-pointer text-[13px] font-medium text-gold">
          {open ? "Mostra meno" : "Leggi tutto"}
        </button>
      )}
    </div>
  );
}

export function Catastali({ rows }: { rows: Record<string, string | number>[] | null }) {
  if (!rows?.length) return null;
  const cols = ["sezione", "foglio", "particella", "subalterno", "graffato"].filter((c) => rows.some((r) => r[c]));
  const multi = rows.some((r) => Number(r.bene) > 1);
  return (
    <div className="overflow-x-auto">
      <table className="num w-full text-[13px]">
        <thead className="text-left">
          <tr>
            {multi && <th className="pb-2 pr-6 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">Bene</th>}
            {cols.map((c) => (
              <th key={c} className="pb-2 pr-6 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              {multi && <td className="py-2 pr-6 text-muted">{r.bene}</td>}
              {cols.map((c) => (
                <td key={c} className="py-2 pr-6 text-ink">
                  {r[c] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DOC_ORDER = ["perizia", "avviso", "ordinanza", "planimetria", "foto", "other"];

export function Gallery({ docs }: { docs: Allegato[] }) {
  const photos = docs.filter((a) => a.image_url);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (open === null) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") setOpen((i) => (i === null ? i : (i + 1) % photos.length));
      if (e.key === "ArrowLeft") setOpen((i) => (i === null ? i : (i - 1 + photos.length) % photos.length));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, photos.length]);
  if (!photos.length) return null;
  const current = open !== null ? photos[open] : undefined;
  return (
    <>
      <div className="scroll-thin flex snap-x gap-1.5 overflow-x-auto pb-1">
        {photos.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setOpen(i)}
            className="group relative h-40 w-60 shrink-0 cursor-zoom-in snap-start overflow-hidden rounded-md bg-surface-2"
            aria-label={`Foto ${i + 1}`}
          >
            <img
              src={apiUrl(p.image_url ?? null) ?? undefined}
              alt=""
              loading="lazy"
              className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
            />
          </button>
        ))}
      </div>
      <AnimatePresence>
        {current && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(null)}
            className="fixed inset-0 z-[60] grid cursor-zoom-out place-items-center bg-black/88 p-4 backdrop-blur-sm"
          >
            <motion.img
              key={current.id}
              initial={{ scale: 0.98, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              src={apiUrl(current.image_url ?? null) ?? undefined}
              alt=""
              className="max-h-[88vh] max-w-[92vw] rounded-md object-contain"
            />
            <p className="num absolute bottom-6 text-[12px] tracking-wide text-white/60">
              {(open ?? 0) + 1} / {photos.length}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function Documents({ docs, meta }: { docs: Allegato[]; meta: Meta | undefined }) {
  docs = docs.filter((a) => !a.image_url);
  if (!docs.length) return null;
  const sorted = [...docs].sort((a, b) => DOC_ORDER.indexOf(a.tipo) - DOC_ORDER.indexOf(b.tipo));
  return (
    <ul className="divide-y divide-line">
      {sorted.map((a) => (
        <li key={a.id}>
          <a href={a.url} target="_blank" rel="noreferrer" className="group flex items-baseline gap-4 py-3">
            <span className={cx("w-28 shrink-0 text-[13.5px] font-medium", a.tipo === "perizia" ? "text-gold" : "text-ink")}>{label(meta?.allegati, a.tipo)}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted group-hover:text-ink">{a.descrizione || a.filename}</span>
            <span className="num shrink-0 text-[12px] text-faint">{bytes(a.size)}</span>
            <ArrowUpRight className="size-3.5 shrink-0 self-center text-faint transition-colors group-hover:text-gold" />
          </a>
        </li>
      ))}
    </ul>
  );
}

export function MiniMap({ lat, lon, category, approx, className }: { lat: number; lon: number; category: string | null; approx: boolean; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  useEffect(() => {
    if (!el.current) return;
    const map = new maplibregl.Map({
      container: el.current,
      style: theme === "dark" ? "https://tiles.openfreemap.org/styles/dark" : "https://tiles.openfreemap.org/styles/positron",
      center: [lon, lat],
      zoom: approx ? 12 : 15,
      interactive: true,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    const color = CATEGORY_COLORS[category ?? ""] ?? CATEGORY_COLORS.ALTRA_CATEGORIA;
    const dot = document.createElement("div");
    dot.style.cssText = approx
      ? `width:64px;height:64px;border-radius:50%;background:${color}1f`
      : `width:14px;height:14px;border-radius:50%;background:${color};box-shadow:0 0 0 4px ${color}33`;
    new maplibregl.Marker({ element: dot }).setLngLat([lon, lat]).addTo(map);
    return () => map.remove();
  }, [lat, lon, category, approx, theme]);
  return <div ref={el} className={cx("overflow-hidden rounded-md", className)} />;
}

export function PropertyFacts({
  d,
  meta,
}: {
  d: {
    superficie_mq: number | null;
    vani: number | null;
    piano: string | null;
    occupazione: string | null;
    category: string | null;
    tipologia: string | null;
    tipo_procedura?: string | null;
    tipo_vendita?: string | null;
  };
  meta: Meta | undefined;
}) {
  return (
    <DetailsGrid
      items={[
        ["Superficie", d.superficie_mq ? mq(d.superficie_mq) : null],
        ["Vani", d.vani ? String(d.vani).replace(".", ",") : null],
        ["Piano", d.piano],
        ["Occupazione", d.occupazione ? label(meta?.occupazione, d.occupazione) : null],
        ["Categoria", d.category ? label(meta?.categorie, d.category) : null],
        ["Tipologia", d.tipologia ? (meta?.tipologie[d.tipologia] ?? label(undefined, d.tipologia)) : null],
        ["Procedura", d.tipo_procedura ?? null],
        ["Tipo vendita", d.tipo_vendita ? label(meta?.tipo_vendita, d.tipo_vendita) : null],
      ]}
    />
  );
}
