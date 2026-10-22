import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowUpRight, Bookmark, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Page } from "@/components/AppShell";
import { Badge, Button, Card, Empty, IconButton, Spinner, Toggle } from "@/components/ui";
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
  if (f.surface_min) out.push(`≥ ${f.surface_min} m²`);
  if (f.occupazione.length) out.push(f.occupazione.map((k) => meta?.occupazione[k] ?? k).join(", "));
  if (f.price_dropped) out.push("con ribasso");
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
    <Page title="Ricerche salvate" subtitle="Con gli avvisi attivi ricevi ogni mattina un'email con nuovi immobili, nuovi esperimenti e ribassi.">
      {isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <Card>
          <Empty icon={<Bookmark className="size-5" />} title="Nessuna ricerca salvata">
            Imposta i filtri sulla mappa e premi «Salva».
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((s, i) => (
            <motion.div key={s.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
              <Card className="flex h-full flex-col p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-serif text-[21px] leading-tight text-ink">{s.name}</h2>
                    <p className="mt-1 text-[12px] text-faint">Creata il {date(s.created_at)}</p>
                  </div>
                  <IconButton label="Elimina" icon={<Trash2 className="size-4" />} onClick={() => confirm(`Eliminare «${s.name}»?`) && remove.mutate(s.id)} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {describe(s.criteria, meta).map((d) => (
                    <Badge key={d}>{d}</Badge>
                  ))}
                </div>
                <div className="mt-5 grid grid-cols-2 gap-2.5">
                  <div className="rounded-2xl bg-surface-2/70 p-3.5">
                    <p className="text-[11.5px] text-muted">In asta ora</p>
                    <p className="num text-[24px] font-semibold text-ink">{s.match_count ?? "—"}</p>
                  </div>
                  <div className="rounded-2xl bg-gold-soft p-3.5">
                    <p className="text-[11.5px] text-muted">Nuovi in 7 giorni</p>
                    <p className="num text-[24px] font-semibold text-gold">{s.new_last_7d ?? "—"}</p>
                  </div>
                </div>
                <div className="mt-auto flex items-center justify-between gap-3 pt-5">
                  <label className="flex items-center gap-2.5 text-[13px] text-ink">
                    <Toggle checked={s.alert_enabled} onChange={(on) => toggle.mutate({ id: s.id, on })} label="Avvisi email" />
                    Avvisi email
                  </label>
                  <Button size="sm" variant="secondary" icon={<ArrowUpRight className="size-3.5" />} onClick={() => nav(`/?${toQuery(fromCriteria(s.criteria))}`)}>
                    Apri sulla mappa
                  </Button>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </Page>
  );
}
