import { useQuery } from "@tanstack/react-query";
import { Moon, Sun } from "lucide-react";
import { useParams } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { PublicLottoView, PvpLink } from "@/components/PublicLottoView";
import { Empty, IconButton, Spinner } from "@/components/ui";
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
          <PublicLottoView
            d={d}
            meta={meta}
            aside={
              <div>
                <p className="font-serif text-[22px] leading-snug text-ink">Vuoi partecipare a quest'asta?</p>
                <p className="mt-3 text-[14px] leading-relaxed text-muted">
                  Lo studio Legal Estate ti assiste in ogni fase: verifica della perizia, visita, offerta e aggiudicazione.
                </p>
                <PvpLink url={d.pvp_url} />
              </div>
            }
            footer={`Dati dal Portale delle Vendite Pubbliche del Ministero della Giustizia. Scheda condivisa da Legal Estate${d.expires_at ? `, valida fino al ${date(d.expires_at)}` : ""}.`}
          />
        )}
      </main>
    </div>
  );
}
