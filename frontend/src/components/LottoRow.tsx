import { Building2, Factory, Home, Store, Trophy } from "lucide-react";
import { apiUrl } from "@/lib/api";
import type { LottoListItem } from "@/lib/types";
import { countdown, date, eur, mq } from "@/lib/format";
import { CATEGORY_COLORS } from "./MapView";
import { cx } from "./ui";

export function CategoryIcon({ category, className }: { category: string | null; className?: string }) {
  const Icon =
    category === "IMMOBILE_RESIDENZIALE"
      ? Home
      : category === "IMMOBILE_COMMERCIALE"
        ? Store
        : category === "IMMOBILE_INDUSTRIALE"
          ? Factory
          : category === "IMPIANTO_SPORTIVO"
            ? Trophy
            : Building2;
  return <Icon className={className} />;
}

export function Thumb({ url, category, className }: { url: string | null; category: string | null; className?: string }) {
  const color = CATEGORY_COLORS[category ?? ""] ?? CATEGORY_COLORS.ALTRA_CATEGORIA;
  return (
    <div className={cx("relative overflow-hidden rounded-md bg-surface-2", className)} style={{ backgroundColor: `${color}12` }}>
      <div className="absolute inset-0 grid place-items-center" style={{ color }}>
        <CategoryIcon category={category} className="size-5 opacity-60" />
      </div>
      {url && (
        <img
          src={apiUrl(url) ?? undefined}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
        />
      )}
    </div>
  );
}

export function DeadlinePill({ deadline, sale, now }: { deadline: string | null; sale: string | null; now: Date }) {
  // Show the offer deadline while it is open, otherwise the sale date.
  const dl = countdown(deadline, now);
  const useDeadline = dl && !dl.past;
  const value = useDeadline ? deadline : sale;
  const c = useDeadline ? dl : countdown(sale, now);
  if (!c || !value) return null;
  const what = useDeadline ? "Offerte entro" : "Vendita";
  if (c.past) return <span className="text-faint">{what} {date(value)}</span>;
  const left = c.days > 0 ? `tra ${c.days} g` : `tra ${c.hours} h ${c.minutes} m`;
  return (
    <span className={cx("num", c.urgent ? "font-medium text-bad" : "text-muted")}>
      {what} {date(value)} · {left}
    </span>
  );
}

export function LottoRow({
  lot,
  active,
  selected,
  onHover,
  onClick,
  now,
}: {
  lot: LottoListItem;
  active: boolean;
  selected: boolean;
  onHover: (id: number | null) => void;
  onClick: () => void;
  now: Date;
}) {
  return (
    <button
      type="button"
      onMouseEnter={() => onHover(lot.id)}
      onMouseLeave={() => onHover(null)}
      onClick={onClick}
      className="group relative flex w-full cursor-pointer gap-4 py-4 pr-2 pl-5 text-left"
    >
      <span className={cx("absolute top-4 bottom-4 left-0 w-[2px] transition-colors", selected ? "bg-gold" : active ? "bg-line-strong" : "bg-transparent")} />
      <Thumb url={lot.cover_url} category={lot.category} className="size-[72px] shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className={cx("truncate font-serif text-[16px] leading-tight transition-colors", selected ? "text-gold" : "text-ink group-hover:text-ink")}>{lot.titolo}</p>
          <p className="num shrink-0 text-[15px] font-medium text-ink">{eur(lot.prezzo_base)}</p>
        </div>
        <p className="mt-1 truncate text-[12.5px] text-muted">{lot.indirizzo || lot.comune || "Indirizzo non indicato"}</p>
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-[11.5px] text-faint">
          <span>
            {lot.tribunale.short_name}
            {lot.rge ? ` ${lot.rge}` : ""}
          </span>
          {lot.superficie_mq ? <span className="num">{mq(lot.superficie_mq)}</span> : null}
          {lot.n_rounds > 1 && <span>{lot.n_rounds} esperimenti</span>}
          {lot.ribasso_pct ? <span className="num text-ok">−{Math.round(lot.ribasso_pct)}%</span> : null}
          {lot.opportunity && lot.sconto_zona_pct ? (
            <span className="num font-semibold text-gold">−{Math.round(lot.sconto_zona_pct)}% sulla zona</span>
          ) : null}
          {lot.approx && <span className="text-warn">posizione approssimativa</span>}
        </p>
        <p className="mt-1 text-[11.5px]">
          <DeadlinePill deadline={lot.termine_offerte} sale={lot.data_vendita} now={now} />
        </p>
      </div>
    </button>
  );
}
