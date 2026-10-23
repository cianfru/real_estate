import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Page } from "@/components/AppShell";
import { PublicLottoView, PvpLink } from "@/components/PublicLottoView";
import { Empty, Spinner, cx } from "@/components/ui";
import { api } from "@/lib/api";
import { date, relative } from "@/lib/format";
import labels from "@/lib/public-labels.json";
import type { Meta, PortalLotto } from "@/lib/types";
import { STATO, STATO_TONE } from "./Portale";

// A client has no access to /meta: labels ship with the bundle, as for share links.
const meta = labels as unknown as Meta;

export default function PortaleLotto() {
  const { id } = useParams();
  const { data: d, isLoading, error } = useQuery({ queryKey: ["portale", id], queryFn: () => api<PortalLotto>(`/portale/immobili/${id}`), retry: false });

  return (
    <Page bare>
      <Link to="/portale" className="mb-10 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> I tuoi immobili
      </Link>
      {isLoading ? (
        <Spinner />
      ) : error || !d ? (
        <Empty title="Immobile non disponibile">Lo studio potrebbe averlo tolto dalla tua selezione.</Empty>
      ) : (
        <PublicLottoView
          d={d}
          meta={meta}
          intro={
            <div className="mt-10 max-w-3xl border-l-2 border-gold pl-6">
              <p className={cx("text-[10.5px] font-semibold tracking-[0.14em] uppercase", STATO_TONE[d.stato] ?? "text-faint")}>
                {STATO[d.stato] ?? d.stato} <span className="font-normal tracking-normal text-faint normal-case">· aggiornato {relative(d.aggiornato)}</span>
              </p>
              {d.nota_cliente ? (
                <p className="mt-3 font-serif text-[18px] leading-relaxed whitespace-pre-line text-ink">{d.nota_cliente}</p>
              ) : (
                <p className="mt-2 text-[14px] text-muted">Lo studio sta seguendo questo immobile per te.</p>
              )}
            </div>
          }
          aside={
            <div>
              <p className="font-serif text-[22px] leading-snug text-ink">Domande su quest'immobile?</p>
              <p className="mt-3 text-[14px] leading-relaxed text-muted">
                Scrivi o chiama lo studio Legal Estate: ti assistiamo nella verifica della perizia, nella visita, nell'offerta e nell'aggiudicazione.
              </p>
              <PvpLink url={d.pvp_url} />
            </div>
          }
          footer={`Dati dal Portale delle Vendite Pubbliche del Ministero della Giustizia, aggiornati ogni notte. Ultimo aggiornamento dello studio: ${date(d.aggiornato)}.`}
        />
      )}
    </Page>
  );
}
