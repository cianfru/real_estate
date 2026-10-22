import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowUpRight, Moon, Sun } from "lucide-react";
import { useParams } from "react-router-dom";
import { AreaValuation } from "@/components/AreaValuation";
import { Logo } from "@/components/Logo";
import { Description, Documents, Gallery, KeyFigures, MiniMap, PropertyFacts, RoundTimeline } from "@/components/LottoParts";
import { Empty, IconButton, Rule, SectionTitle, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { date } from "@/lib/format";
import { useTheme } from "@/lib/hooks";
import labels from "@/lib/public-labels.json";
import type { Meta, PublicLotto } from "@/lib/types";

// The public page has no session, so labels ship with the bundle instead of coming from /meta.
const meta = labels as unknown as Meta;

export default function PublicShare() {
  const { token } = useParams();
  const { theme, toggle } = useTheme();
  const { data: d, isLoading, error } = useQuery({ queryKey: ["public", token], queryFn: () => api<PublicLotto>(`/public/lotti/${token}`), retry: false });

  return (
    <div className="min-h-full">
      <header className="glass sticky top-0 z-20">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <a href="https://www.legalestateitalia.it" target="_blank" rel="noreferrer">
            <Logo />
          </a>
          <IconButton label="Cambia tema" icon={theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />} onClick={toggle} />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-14">
        {isLoading ? (
          <div className="grid place-items-center py-24">
            <Spinner />
          </div>
        ) : error || !d ? (
          <Empty title="Link non disponibile">Il link è scaduto o è stato revocato. Contatta lo studio per riceverne uno nuovo.</Empty>
        ) : (
          <motion.article initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-gold">Asta giudiziaria · {d.tribunale}</p>
            <h1 className="mt-4 max-w-3xl font-serif text-[46px] leading-[1.05] tracking-tight text-ink">{d.titolo}</h1>
            <p className="mt-4 text-[16px] text-muted">
              {[d.indirizzo, d.comune && !d.indirizzo?.includes(d.comune) ? d.comune : null, d.provincia].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-1 text-[13px] text-faint">
              RGE {d.rge ?? "—"} · Lotto {d.lotto_codice ?? "—"}
            </p>

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
                <div>
                  <p className="font-serif text-[22px] leading-snug text-ink">Vuoi partecipare a quest'asta?</p>
                  <p className="mt-3 text-[14px] leading-relaxed text-muted">
                    Lo studio Legal Estate ti assiste in ogni fase: verifica della perizia, visita, offerta e aggiudicazione.
                  </p>
                  {d.pvp_url && (
                    <a href={d.pvp_url} target="_blank" rel="noreferrer" className="group mt-5 inline-flex items-center gap-1 text-[14px] font-medium text-gold">
                      <span className="underline decoration-transparent underline-offset-[5px] group-hover:decoration-current/40">Annuncio ufficiale sul PVP</span>
                      <ArrowUpRight className="size-4" />
                    </a>
                  )}
                </div>
              </aside>
            </div>
            <p className="mt-20 text-center text-[12px] text-faint">
              Dati dal Portale delle Vendite Pubbliche del Ministero della Giustizia. Scheda condivisa da Legal Estate
              {d.expires_at ? `, valida fino al ${date(d.expires_at)}` : ""}.
            </p>
          </motion.article>
        )}
      </main>
    </div>
  );
}
