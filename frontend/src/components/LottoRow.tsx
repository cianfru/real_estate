import { motion } from "framer-motion";
import { Building2, Factory, Home, Store, Trophy, TrendingDown } from "lucide-react";
import { apiUrl } from "@/lib/api";
import type { LottoListItem } from "@/lib/types";
import { countdown, date, eur, mq } from "@/lib/format";
import { CATEGORY_COLORS } from "./MapView";
import { Badge, cx } from "./ui";

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
    <div
      className={cx("relative overflow-hidden rounded-xl bg-surface-2", className)}
      style={{ backgroundImage: `linear-gradient(135deg, ${color}22, ${color}08)` }}
    >
      <div className="absolute inset-0 grid place-items-center" style={{ color }}>
        <CategoryIcon category={category} className="size-6 opacity-70" />
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
    <motion.button
      type="button"
      onMouseEnter={() => onHover(lot.id)}
      onMouseLeave={() => onHover(null)}
      onClick={onClick}
      whileTap={{ scale: 0.99 }}
      className={cx(
        "group flex w-full cursor-pointer gap-3 rounded-2xl p-2.5 text-left transition-colors",
        selected ? "bg-gold-soft" : active ? "bg-surface-2" : "hover:bg-surface-2",
      )}
    >
      <Thumb url={lot.cover_url} category={lot.category} className="size-[76px] shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate font-serif text-[15.5px] leading-tight text-ink">{lot.titolo}</p>
          <p className="num shrink-0 text-[15px] font-semibold text-ink">{eur(lot.prezzo_base)}</p>
        </div>
        <p className="mt-0.5 truncate text-[12.5px] text-muted">
          {lot.indirizzo || lot.comune || "Indirizzo non indicato"}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
          <span className="text-faint">
            {lot.tribunale.short_name}
            {lot.rge ? ` · ${lot.rge}` : ""}
          </span>
          {lot.superficie_mq ? <span className="num text-faint">{mq(lot.superficie_mq)}</span> : null}
          {lot.ribasso_pct ? (
            <Badge tone="ok">
              <TrendingDown className="size-3" />
              <span className="num">−{Math.round(lot.ribasso_pct)}%</span>
            </Badge>
          ) : null}
          {lot.n_rounds > 1 && <Badge>{lot.n_rounds} esperimenti</Badge>}
          {lot.approx && <Badge tone="warn">pos. approssimativa</Badge>}
        </div>
        <div className="mt-1 text-[11.5px]">
          <DeadlinePill deadline={lot.termine_offerte} sale={lot.data_vendita} now={now} />
        </div>
      </div>
    </motion.button>
  );
}
