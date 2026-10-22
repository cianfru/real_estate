// Building blocks of the property card, shared by the staff card and the public share page.
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  CalendarClock,
  FileImage,
  FileText,
  Gavel,
  Layers,
  Map as MapIcon,
  Ruler,
  ScrollText,
  TrendingDown,
} from "lucide-react";
import maplibregl from "maplibre-gl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiUrl } from "@/lib/api";
import type { Allegato, Meta, Round } from "@/lib/types";
import { bytes, countdown, date, dateLong, dateTime, eur, mq, pct } from "@/lib/format";
import { label, useNow, useTheme } from "@/lib/hooks";
import { CATEGORY_COLORS } from "./MapView";
import { Badge, SectionTitle, cx } from "./ui";

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

function Stat({
  label: l,
  value,
  sub,
  className,
  big,
  hero,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
  big?: boolean;
  hero?: boolean;
}) {
  return (
    <div
      className={cx(
        "rounded-2xl p-4",
        hero ? "bg-[#0b263b] text-[#f6f5f2] dark:bg-[#1c2a37]" : "bg-surface-2/70 text-ink",
        className,
      )}
    >
      <p className={cx("text-[11.5px] font-medium", hero ? "text-[#f6f5f2]/70" : "text-muted")}>{l}</p>
      <p className={cx("num mt-1 font-semibold tracking-tight", big ? "text-[28px] leading-none" : "text-[17px]")}>{value}</p>
      {sub && <div className={cx("mt-1.5 text-[12px]", hero ? "text-[#f6f5f2]/75" : "text-muted")}>{sub}</div>}
    </div>
  );
}

export function KeyFigures({ d, meta }: { d: CardFacts; meta: Meta | undefined }) {
  const now = useNow(30_000);
  const deadline = d.termine_offerte ?? d.data_vendita;
  const c = countdown(deadline, now);
  const sconto = d.sconto_stima_pct ?? (d.valore_stima && d.prezzo_base ? (1 - d.prezzo_base / d.valore_stima) * 100 : null);
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      <Stat
        big
        hero
        className="col-span-2"
        label="Prezzo base"
        value={eur(d.prezzo_base)}
        sub={
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {d.offerta_minima ? (
              <span>
                Offerta minima <b className="num font-semibold">{eur(d.offerta_minima)}</b>
              </span>
            ) : null}
            {d.rialzo_minimo ? (
              <span>
                Rilancio <b className="num font-semibold">{eur(d.rialzo_minimo)}</b>
              </span>
            ) : null}
          </span>
        }
      />
      <div
        className={cx(
          "col-span-2 rounded-2xl p-4",
          c?.urgent ? "bg-bad/10" : "bg-surface-2/70",
        )}
      >
        <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
          <CalendarClock className="size-3.5" /> {d.termine_offerte ? "Termine offerte" : "Data vendita"}
        </p>
        {c && !c.past ? (
          <p className={cx("num mt-1 text-[28px] font-semibold leading-none tracking-tight", c.urgent ? "text-bad" : "text-ink")}>
            {c.days > 0 ? (
              <>
                {c.days}
                <span className="text-[15px] font-medium text-muted"> g </span>
                {c.hours}
                <span className="text-[15px] font-medium text-muted"> h</span>
              </>
            ) : (
              <>
                {c.hours}
                <span className="text-[15px] font-medium text-muted"> h </span>
                {c.minutes}
                <span className="text-[15px] font-medium text-muted"> m</span>
              </>
            )}
          </p>
        ) : (
          <p className="mt-1 text-[17px] font-semibold text-muted">Scaduto</p>
        )}
        <p className="mt-1.5 text-[12px] text-muted">{dateTime(deadline)}</p>
      </div>
      <Stat
        label="Valore di stima"
        value={d.valore_stima ? eur(d.valore_stima) : "—"}
        sub={sconto ? <span className="text-ok">−{pct(sconto)} vs stima</span> : <span className="text-faint">non indicato su PVP</span>}
      />
      <Stat
        label="Ribasso"
        value={d.ribasso_pct ? <span className="text-ok">−{pct(d.ribasso_pct)}</span> : "—"}
        sub={d.prezzo_primo_esperimento ? <>dal 1° esperimento ({eur(d.prezzo_primo_esperimento)})</> : "primo esperimento"}
      />
      <Stat label="€/m²" value={d.prezzo_mq ? eur(d.prezzo_mq) : "—"} sub="sul prezzo base" />
      <Stat
        label="Vendita"
        value={<span className="text-[15px]">{label(meta?.modalita, d.modalita)}</span>}
        sub={d.data_vendita ? dateLong(d.data_vendita) : undefined}
      />
      {d.deposito_cauzionale && (
        <p className="col-span-2 px-1 text-[12px] text-muted sm:col-span-4">
          Cauzione: <span className="text-ink">{d.deposito_cauzionale}</span>
        </p>
      )}
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
      <ol className="relative space-y-1">
        {ordered.map((r, i) => (
          <motion.li
            key={r.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className={cx("relative grid grid-cols-[22px_1fr] gap-3 rounded-xl px-2 py-2", r.is_current && "bg-gold-soft")}
          >
            <div className="relative flex justify-center">
              <span
                className={cx(
                  "relative z-10 mt-1 size-3 rounded-full ring-4 ring-surface",
                  r.is_current ? "bg-gold" : r.esito === "AGGIU" ? "bg-ok" : "bg-line-strong",
                )}
              />
              {i < ordered.length - 1 && <span className="absolute top-4 bottom-[-12px] w-px bg-line-strong" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-[13px] font-medium text-ink">
                  {r.round_number ? `${r.round_number}° esperimento` : "Esperimento"} · <span className="num">{date(r.data_vendita)}</span>
                </p>
                <p className="num text-[14px] font-semibold text-ink">{eur(r.prezzo_base)}</p>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${((r.prezzo_base ?? 0) / max) * 100}%` }}
                  transition={{ duration: 0.6, delay: 0.1 + i * 0.04, ease: [0.22, 1, 0.36, 1] }}
                  className={cx("h-full rounded-full", r.is_current ? "bg-gold" : "bg-navy/30")}
                />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px]">
                {r.drop_pct ? (
                  <Badge tone="ok">
                    <TrendingDown className="size-3" />
                    <span className="num">−{pct(r.drop_pct, 1)}</span>
                  </Badge>
                ) : null}
                {r.esito && <Badge tone={r.esito === "AGGIU" ? "ok" : "neutral"}>{label(meta?.esiti, r.esito)}</Badge>}
                {r.is_current && <Badge tone="gold">In corso</Badge>}
                {r.modalita && <span className="text-faint">{label(meta?.modalita, r.modalita)}</span>}
                <a href={r.pvp_url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-0.5 text-faint hover:text-gold">
                  PVP <ArrowUpRight className="size-3" />
                </a>
              </div>
            </div>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}

export function DetailsGrid({
  items,
}: {
  items: [string, ReactNode][];
}) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      {items
        .filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== "—")
        .map(([k, v]) => (
          <div key={k}>
            <dt className="text-[11.5px] text-muted">{k}</dt>
            <dd className="num mt-0.5 text-[13.5px] text-ink">{v}</dd>
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
      <p className={cx("whitespace-pre-line text-[14px] leading-relaxed text-ink/90", !open && long && "line-clamp-5")}>{text}</p>
      {long && (
        <button onClick={() => setOpen(!open)} className="mt-1 cursor-pointer text-[13px] font-medium text-gold">
          {open ? "Mostra meno" : "Leggi tutto"}
        </button>
      )}
    </div>
  );
}

export function Catastali({ rows }: { rows: Record<string, string | number>[] | null }) {
  if (!rows?.length) return null;
  const cols = ["sezione", "foglio", "particella", "subalterno", "graffato"].filter((c) => rows.some((r) => r[c]));
  return (
    <div className="overflow-x-auto rounded-xl hairline">
      <table className="num w-full text-[12.5px]">
        <thead className="bg-surface-2/70 text-left text-muted">
          <tr>
            {rows.some((r) => Number(r.bene) > 1) && <th className="px-3 py-2 font-medium">Bene</th>}
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 font-medium capitalize">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              {rows.some((x) => Number(x.bene) > 1) && <td className="px-3 py-2">{r.bene}</td>}
              {cols.map((c) => (
                <td key={c} className="px-3 py-2 text-ink">
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
      <div className="scroll-thin -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
        {photos.map((p, i) => (
          <motion.button
            key={p.id}
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setOpen(i)}
            className="relative h-36 w-52 shrink-0 cursor-zoom-in snap-start overflow-hidden rounded-xl bg-surface-2"
            aria-label={`Foto ${i + 1}`}
          >
            <img src={apiUrl(p.image_url ?? null) ?? undefined} alt="" loading="lazy" className="size-full object-cover" />
          </motion.button>
        ))}
      </div>
      <AnimatePresence>
        {current && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(null)}
            className="fixed inset-0 z-[60] grid cursor-zoom-out place-items-center bg-black/85 p-4 backdrop-blur-sm"
          >
            <motion.img
              key={current.id}
              initial={{ scale: 0.97, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              src={apiUrl(current.image_url ?? null) ?? undefined}
              alt=""
              className="max-h-[88vh] max-w-[92vw] rounded-2xl object-contain shadow-float"
            />
            <p className="absolute bottom-5 text-[12.5px] text-white/70">
              {(open ?? 0) + 1} / {photos.length} · ← → per scorrere
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
    <div className="grid gap-1.5 sm:grid-cols-2">
      {sorted.map((a) => {
        const Icon = a.tipo === "foto" ? FileImage : a.tipo === "planimetria" ? MapIcon : a.tipo === "perizia" ? ScrollText : a.tipo === "ordinanza" ? Gavel : FileText;
        return (
          <motion.a
            key={a.id}
            href={a.url}
            target="_blank"
            rel="noreferrer"
            whileHover={{ scale: 1.01 }}
            className="flex items-center gap-3 rounded-xl bg-surface-2/70 px-3 py-2.5 transition-colors hover:bg-surface-2"
          >
            <span className={cx("grid size-9 shrink-0 place-items-center rounded-lg", a.tipo === "perizia" ? "bg-gold-soft text-gold" : "bg-surface text-muted")}>
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink">{label(meta?.allegati, a.tipo)}</span>
              <span className="block truncate text-[11.5px] text-faint">
                {a.descrizione || a.filename} {a.size ? `· ${bytes(a.size)}` : ""}
              </span>
            </span>
            <ArrowUpRight className="size-4 shrink-0 text-faint" />
          </motion.a>
        );
      })}
    </div>
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
      ? `width:64px;height:64px;border-radius:50%;background:${color}22;border:2px dashed ${color}`
      : `width:18px;height:18px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.25)`;
    new maplibregl.Marker({ element: dot }).setLngLat([lon, lat]).addTo(map);
    return () => map.remove();
  }, [lat, lon, category, approx, theme]);
  return <div ref={el} className={cx("overflow-hidden rounded-2xl", className)} />;
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
        ["Superficie", d.superficie_mq ? <span className="inline-flex items-center gap-1"><Ruler className="size-3.5 text-faint" />{mq(d.superficie_mq)}</span> : null],
        ["Vani", d.vani ? String(d.vani).replace(".", ",") : null],
        ["Piano", d.piano],
        ["Occupazione", d.occupazione ? label(meta?.occupazione, d.occupazione) : null],
        ["Categoria", d.category ? label(meta?.categorie, d.category) : null],
        ["Tipologia", d.tipologia ? <span className="inline-flex items-center gap-1"><Layers className="size-3.5 text-faint" />{meta?.tipologie[d.tipologia] ?? label(undefined, d.tipologia)}</span> : null],
        ["Procedura", d.tipo_procedura ?? null],
        ["Tipo vendita", d.tipo_vendita ? label(meta?.tipo_vendita, d.tipo_vendita) : null],
      ]}
    />
  );
}
