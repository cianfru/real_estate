import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ExternalLink, Moon, Sun } from "lucide-react";
import { useParams } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { Description, Documents, Gallery, KeyFigures, MiniMap, PropertyFacts, RoundTimeline } from "@/components/LottoParts";
import { Thumb } from "@/components/LottoRow";
import { Button, Card, Empty, IconButton, SectionTitle, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { date } from "@/lib/format";
import { useTheme } from "@/lib/hooks";
import type { Meta, PublicLotto } from "@/lib/types";
import labels from "@/lib/public-labels.json";

// The public page has no session, so labels ship with the bundle instead of coming from /meta.
const meta = labels as unknown as Meta;

export default function PublicShare() {
  const { token } = useParams();
  const { theme, toggle } = useTheme();
  const { data: d, isLoading, error } = useQuery({
    queryKey: ["public", token],
    queryFn: () => api<PublicLotto>(`/public/lotti/${token}`),
    retry: false,
  });

  return (
    <div className="min-h-full">
      <header className="glass sticky top-0 z-20 border-b border-line">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
          <a href="https://www.legalestateitalia.it" target="_blank" rel="noreferrer">
            <Logo />
          </a>
          <IconButton label="Cambia tema" icon={theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />} onClick={toggle} />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        {isLoading ? (
          <div className="grid place-items-center py-24">
            <Spinner />
          </div>
        ) : error || !d ? (
          <Card>
            <Empty title="Link non disponibile">Il link è scaduto o è stato revocato. Contatta lo studio per riceverne uno nuovo.</Empty>
          </Card>
        ) : (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="space-y-6">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
              <Thumb url={d.cover_url} category={d.category} className="h-44 w-full shrink-0 sm:size-40" />
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-gold">Asta giudiziaria · {d.tribunale}</p>
                <h1 className="mt-2 font-serif text-[36px] leading-[1.1] tracking-tight text-ink">{d.titolo}</h1>
                <p className="mt-2 text-[15px] text-muted">{[d.indirizzo, d.comune && !d.indirizzo?.includes(d.comune) ? d.comune : null, d.provincia].filter(Boolean).join(" · ")}</p>
                <p className="mt-1 text-[13px] text-faint">
                  RGE {d.rge ?? "—"} · Lotto {d.lotto_codice ?? "—"}
                </p>
              </div>
            </div>

            <Card className="p-5 sm:p-6">
              <KeyFigures d={d} meta={meta} />
              {d.allegati.some((a) => a.image_url) && (
                <div className="mt-5">
                  <Gallery docs={d.allegati} />
                </div>
              )}
            </Card>

            <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
              <Card className="space-y-8 p-6 sm:p-8">
                <section>
                  <SectionTitle>L'immobile</SectionTitle>
                  <PropertyFacts d={d} meta={meta} />
                  <div className="mt-5">
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
              </Card>
              <div className="space-y-6">
                {d.lat !== null && d.lon !== null && (
                  <MiniMap lat={d.lat} lon={d.lon} category={d.category} approx={d.approx} className="h-72 hairline" />
                )}
                <Card className="p-6">
                  <p className="font-serif text-[19px] text-ink">Vuoi partecipare a quest'asta?</p>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
                    Lo studio Legal Estate ti assiste in ogni fase: verifica della perizia, visita, offerta e aggiudicazione.
                  </p>
                  {d.pvp_url && (
                    <a href={d.pvp_url} target="_blank" rel="noreferrer" className="mt-4 block">
                      <Button variant="secondary" className="w-full" icon={<ExternalLink className="size-4" />}>
                        Annuncio ufficiale sul PVP
                      </Button>
                    </a>
                  )}
                </Card>
              </div>
            </div>
            <p className="text-center text-[12px] text-faint">
              Dati dal Portale delle Vendite Pubbliche del Ministero della Giustizia. Scheda condivisa da Legal Estate
              {d.expires_at ? `, valida fino al ${date(d.expires_at)}` : ""}.
            </p>
          </motion.div>
        )}
      </main>
    </div>
  );
}
