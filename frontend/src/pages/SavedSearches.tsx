import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Page } from "@/components/AppShell";
import { Button, Empty, Spinner, cx } from "@/components/ui";
import { api, del, patch } from "@/lib/api";
import { fromCriteria, toQuery } from "@/lib/filters";
import { date, eur } from "@/lib/format";
import { useMeta } from "@/lib/hooks";
import type { Meta, SavedSearch } from "@/lib/types";

function describe(c: Record<string, unknown>, meta: Meta | undefined): string[] {
  const f = fromCriteria(c);
  const out: string[] = [];
  if (f.tribunale.length) out.push(f.tribunale.map((id) => meta?.tribunali.find((t) => t.id === id)?.short_name ?? id).join(", "));
  if (f.category.length) out.push(f.category.map((k) => meta?.categorie[k] ?? k).join(", "));
  if (f.tipologia.length) out.push(f.tipologia.map((k) => meta?.tipologie[k] ?? k).join(", "));
  if (f.price_min || f.price_max) out.push(`${f.price_min ? eur(f.price_min) : "€ 0"} – ${f.price_max ? eur(f.price_max) : "∞"}`);
  if (f.comune) out.push(f.comune);
  if (f.q) out.push(`“${f.q}”`);
  if (f.surface_min) out.push(`almeno ${f.surface_min} m²`);
  if (f.occupazione.length) out.push(f.occupazione.map((k) => meta?.occupazione[k] ?? k).join(", "));
  if (f.price_dropped) out.push("con ribasso");
  if (f.opportunity) out.push("solo opportunità");
  if (f.polygon) out.push("area disegnata");
  return out;
}

export default function SavedSearches() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data: meta } = useMeta();
  const { data, isLoading } = useQuery({ queryKey: ["saved-searches"], queryFn: () => api<SavedSearch[]>("/saved-searches") });
  const toggle = useMutation({
    mutationFn: ({ id, on }: { id: number; on: boolean }) => patch(`/saved-searches/${id}/alert?enabled=${on}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-searches"] }),
  });
  const remove = useMutation({ mutationFn: (id: number) => del(`/saved-searches/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-searches"] }) });

  return (
    <Page title="Ricerche salvate" subtitle="Con gli avvisi attivi ricevi ogni mattina un'email con nuovi immobili, nuovi esperimenti, ribassi e opportunità.">
      {isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <Empty title="Nessuna ricerca salvata">Imposta i filtri sulla mappa e scegli «Salva ricerca».</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {data.map((s, i) => (
            <motion.li key={s.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="grid gap-6 py-9 md:grid-cols-[1fr_auto_auto] md:items-center md:gap-14">
              <div className="min-w-0">
                <h2 className="font-serif text-[25px] leading-tight text-ink">{s.name}</h2>
                <p className="mt-2 text-[13.5px] text-muted">{describe(s.criteria, meta).join(" · ") || "Tutte le aste"}</p>
                <p className="mt-1 text-[11.5px] text-faint">Creata il {date(s.created_at)}</p>
              </div>
              <div className="flex gap-12">
                <div>
                  <p className="num text-[32px] font-light leading-none text-ink">{s.match_count ?? "—"}</p>
                  <p className="mt-1.5 text-[11.5px] text-muted">in asta ora</p>
                </div>
                <div>
                  <p className="num text-[32px] font-light leading-none text-gold">{s.new_last_7d ?? "—"}</p>
                  <p className="mt-1.5 text-[11.5px] text-muted">nuovi in 7 giorni</p>
                </div>
              </div>
              <div className="flex flex-col items-start gap-1 md:items-end">
                <Button size="sm" variant="primary" onClick={() => nav(`/?${toQuery(fromCriteria(s.criteria))}`)}>
                  Apri sulla mappa
                </Button>
                <button
                  className={cx("cursor-pointer py-1 text-[13px] transition-colors", s.alert_enabled ? "text-gold" : "text-muted hover:text-ink")}
                  onClick={() => toggle.mutate({ id: s.id, on: !s.alert_enabled })}
                >
                  {s.alert_enabled ? "Avvisi email attivi" : "Attiva gli avvisi email"}
                </button>
                <button className="cursor-pointer py-1 text-[13px] text-faint transition-colors hover:text-bad" onClick={() => confirm(`Eliminare «${s.name}»?`) && remove.mutate(s.id)}>
                  Elimina
                </button>
              </div>
            </motion.li>
          ))}
        </ul>
      )}
    </Page>
  );
}
