import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Building2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Page } from "@/components/AppShell";
import { DeadlinePill } from "@/components/LottoRow";
import { Empty, SectionTitle, Spinner, cx } from "@/components/ui";
import { api, apiUrl } from "@/lib/api";
import { eur } from "@/lib/format";
import { useMe, useNow } from "@/lib/hooks";
import type { PortalItem } from "@/lib/types";

/** How the firm's working status reads to the client. */
export const STATO: Record<string, string> = {
  in_valutazione: "In valutazione",
  offerta_presentata: "Offerta presentata",
  aggiudicato: "Aggiudicato",
  scartato: "Archiviato",
};
export const STATO_TONE: Record<string, string> = {
  in_valutazione: "text-faint",
  offerta_presentata: "text-gold",
  aggiudicato: "text-ok",
  scartato: "text-faint",
};

export default function Portale() {
  const { data: me } = useMe();
  const now = useNow();
  const { data, isLoading } = useQuery({ queryKey: ["portale"], queryFn: () => api<PortalItem[]>("/portale/immobili") });
  const active = data?.filter((i) => i.stato !== "scartato") ?? [];
  const archived = data?.filter((i) => i.stato === "scartato") ?? [];

  return (
    <Page
      title="I tuoi immobili"
      subtitle={`Gli immobili all'asta che lo studio Legal Estate ha selezionato${me?.cliente_name ? ` per ${me.cliente_name}` : " per te"}, con le nostre note e lo stato di ogni pratica.`}
    >
      {isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <Empty icon={<Building2 className="size-5" />} title="Ancora nessun immobile">
          Lo studio non ha ancora selezionato immobili per te. Li troverai qui appena pronti.
        </Empty>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {active.map((i, n) => (
              <Row key={i.lotto_id} item={i} now={now} index={n} />
            ))}
          </ul>
          {archived.length > 0 && (
            <div className="mt-16">
              <SectionTitle>Archiviati</SectionTitle>
              <ul className="divide-y divide-line opacity-70">
                {archived.map((i, n) => (
                  <Row key={i.lotto_id} item={i} now={now} index={n} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Page>
  );
}

function Row({ item: i, now, index }: { item: PortalItem; now: Date; index: number }) {
  const cover = apiUrl(i.cover_url);
  return (
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 8) * 0.04 }}>
      <Link to={`/portale/${i.lotto_id}`} className="group grid grid-cols-[88px_1fr] gap-x-6 gap-y-2 py-6 sm:grid-cols-[120px_1fr_auto]">
        <div className="row-span-2 aspect-[4/3] overflow-hidden rounded-lg bg-surface-2">
          {cover && <img src={cover} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />}
        </div>
        <div className="min-w-0">
          <p className={cx("text-[10.5px] font-semibold tracking-[0.14em] uppercase", STATO_TONE[i.stato] ?? "text-faint")}>{STATO[i.stato] ?? i.stato}</p>
          <p className="mt-1 font-serif text-[21px] leading-snug text-ink group-hover:text-gold">{i.titolo}</p>
          <p className="mt-1 text-[13px] text-muted">
            {[i.comune, i.provincia && i.provincia !== i.comune ? `(${i.provincia})` : null].filter(Boolean).join(" ")} · Tribunale di {i.tribunale}
            {i.superficie_mq ? ` · ${Math.round(i.superficie_mq)} m²` : ""}
          </p>
        </div>
        <div className="col-start-2 flex flex-wrap items-baseline gap-x-5 gap-y-1 sm:col-start-3 sm:row-start-1 sm:block sm:text-right">
          <p className="num text-[18px] font-semibold whitespace-nowrap text-ink">{eur(i.prezzo_base)}</p>
          <div className="text-[12.5px] sm:mt-1">
            <DeadlinePill deadline={i.termine_offerte} sale={i.data_vendita} now={now} />
          </div>
        </div>
        {i.nota_cliente && (
          <p className="col-start-2 max-w-[65ch] border-l-2 border-gold pl-4 font-serif text-[15px] leading-relaxed text-ink/85 sm:col-span-2">
            {i.nota_cliente}
          </p>
        )}
      </Link>
    </motion.li>
  );
}
