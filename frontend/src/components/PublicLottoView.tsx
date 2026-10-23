import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { AreaValuation } from "@/components/AreaValuation";
import { Description, Documents, Gallery, KeyFigures, MiniMap, PropertyFacts, RoundTimeline } from "@/components/LottoParts";
import { Rule, SectionTitle } from "@/components/ui";
import type { Meta, PublicLotto } from "@/lib/types";

/** The client-facing card of a property: share links and the client area. No notes, no
 * clients, no contacts: only what the firm may show. */
export function PublicLottoView({ d, meta, intro, aside, footer }: { d: PublicLotto; meta: Meta; intro?: ReactNode; aside: ReactNode; footer: ReactNode }) {
  return (
    <motion.article initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-gold">Asta giudiziaria · {d.tribunale}</p>
      <h1 className="mt-4 max-w-3xl font-serif text-[46px] leading-[1.05] tracking-tight text-ink">{d.titolo}</h1>
      <p className="mt-4 text-[16px] text-muted">
        {[d.indirizzo, d.comune && !d.indirizzo?.includes(d.comune) ? d.comune : null, d.provincia].filter(Boolean).join(" · ")}
      </p>
      <p className="mt-1 text-[13px] text-faint">
        RGE {d.rge ?? "—"} · Lotto {d.lotto_codice ?? "—"}
      </p>

      {intro}

      {d.allegati.some((a) => a.image_url) && (
        <div className="mt-12">
          <Gallery docs={d.allegati} />
        </div>
      )}

      <div className="mt-14">
        <KeyFigures d={d} meta={meta} />
      </div>

      <div className="-mx-8">
        <AreaValuation lot={{ ...d, opportunity: false }} />
      </div>

      <Rule className="my-14" />

      <div className="grid gap-16 lg:grid-cols-[1fr_340px]">
        <div className="space-y-14">
          <section>
            <SectionTitle>L'immobile</SectionTitle>
            <PropertyFacts d={d} meta={meta} />
            <div className="mt-7">
              <Description text={d.descrizione} />
            </div>
          </section>
          <RoundTimeline rounds={d.rounds} meta={meta} />
          {d.allegati.some((a) => !a.image_url) && (
            <section>
              <SectionTitle>Documenti ufficiali</SectionTitle>
              <Documents docs={d.allegati} meta={meta} />
            </section>
          )}
        </div>
        <aside className="space-y-12">
          {d.lat !== null && d.lon !== null && <MiniMap lat={d.lat} lon={d.lon} category={d.category} approx={d.approx} className="h-72" />}
          {aside}
        </aside>
      </div>
      <p className="mt-20 text-center text-[12px] text-faint">{footer}</p>
    </motion.article>
  );
}

export function PvpLink({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="group mt-5 inline-flex items-center gap-1 text-[14px] font-medium text-gold">
      <span className="underline decoration-transparent underline-offset-[5px] group-hover:decoration-current/40">Annuncio ufficiale sul PVP</span>
      <span aria-hidden>↗</span>
    </a>
  );
}
