import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Loader2, Play, XCircle } from "lucide-react";
import { useState } from "react";
import { Page } from "@/components/AppShell";
import { Badge, Button, Card, Segmented, Spinner, Toggle, cx } from "@/components/ui";
import { api, patch, post } from "@/lib/api";
import { dateTime, relative } from "@/lib/format";
import { label, useMe, useMeta } from "@/lib/hooks";
import type { AdminStats, IngestRun, TribunaleMeta } from "@/lib/types";

function duration(r: IngestRun): string {
  if (!r.finished_at) return "in corso";
  const s = Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000);
  return s > 90 ? `${Math.round(s / 60)} min` : `${s} s`;
}

const KEY_COUNTS = ["list_rows", "vendite_created", "lotti_created", "details_fetched", "history_rows", "event_new_lot", "event_new_round", "event_price_drop", "geocoded_nominatim", "geocoded_comune", "emails", "pvp_requests"];

function Tile({ label: l, value, sub, className, hero }: { label: string; value: string | number; sub?: string; className?: string; hero?: boolean }) {
  return (
    <div className={cx("rounded-2xl p-5 shadow-soft", hero ? "bg-[#0b263b] text-[#f6f5f2] dark:bg-[#1c2a37]" : "hairline bg-surface text-ink", className)}>
      <p className={cx("text-[12px] font-medium", hero ? "text-[#f6f5f2]/70" : "text-muted")}>{l}</p>
      <p className="num mt-1.5 text-[30px] font-semibold leading-none tracking-tight">{typeof value === "number" ? value.toLocaleString("it-IT") : value}</p>
      {sub && <p className={cx("mt-2 text-[12px]", hero ? "text-[#f6f5f2]/60" : "text-faint")}>{sub}</p>}
    </div>
  );
}

export default function Admin() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: meta } = useMeta();
  const [scope, setScope] = useState<"veneto" | "italy">("veneto");
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api<IngestRun[]>("/admin/runs"), refetchInterval: 10_000 });
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => api<AdminStats>("/admin/stats"), refetchInterval: 30_000 });
  const trib = useQuery({ queryKey: ["admin-trib"], queryFn: () => api<TribunaleMeta[]>("/admin/tribunali") });
  const sync = useMutation({
    mutationFn: () => post(`/admin/sync?scope=${scope}`),
    onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ["runs"] }), 800),
  });
  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => patch(`/admin/tribunali/${id}?active=${active}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-trib"] });
      qc.invalidateQueries({ queryKey: ["meta"] });
    },
  });
  const s = stats.data;
  const running = runs.data?.some((r) => r.status === "running");
  const enriched = trib.data?.filter((t) => t.active_for_enrichment) ?? [];

  return (
    <Page
      title="Amministrazione"
      subtitle={meta?.last_sync_at ? `Ultima sincronizzazione completata ${relative(meta.last_sync_at)}` : "Nessuna sincronizzazione completata"}
      actions={
        me?.is_admin && (
          <div className="flex items-center gap-2">
            <Segmented
              value={scope}
              onChange={setScope}
              options={[
                { value: "veneto", label: "Veneto" },
                { value: "italy", label: "Italia" },
              ]}
            />
            <Button variant="primary" icon={<Play className="size-4" />} loading={sync.isPending || running} onClick={() => sync.mutate()}>
              {running ? "Sincronizzazione in corso" : "Avvia sincronizzazione"}
            </Button>
          </div>
        )
      }
    >
      {sync.error && <p className="mb-4 text-[13px] text-bad">{(sync.error as Error).message}</p>}
      {!s ? (
        <Spinner />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tile hero className="col-span-2" label="Immobili in asta" value={s.lotti_by_status.active ?? 0} sub={`${(s.vendite ?? 0).toLocaleString("it-IT")} esperimenti in archivio`} />
          <Tile label="Con posizione" value={s.active_with_coords} sub={`${s.approx_coords} approssimative · ${s.active_without_coords} da geocodificare`} />
          <Tile label="Con dettaglio completo" value={s.active_with_detail} sub="tribunali attivi + richieste manuali" />
          <Card className="col-span-2 p-5">
            <p className="text-[12px] font-medium text-muted">Ultimi 7 giorni</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.keys(s.eventi_7d).filter((k) => k !== "geocoded").length === 0 && (
                <p className="text-[13px] text-faint">Nessun evento: le novità compaiono dalla seconda sincronizzazione.</p>
              )}
              {Object.entries(s.eventi_7d)
                .filter(([k]) => k !== "geocoded")
                .map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-surface-2/70 px-3 py-2">
                    <p className="num text-[18px] font-semibold text-ink">{v.toLocaleString("it-IT")}</p>
                    <p className="text-[11.5px] text-muted">{label(meta?.eventi, k)}</p>
                  </div>
                ))}
            </div>
          </Card>
          <Card className="col-span-2 p-5">
            <p className="text-[12px] font-medium text-muted">Tribunali arricchiti (dettaglio + storico + geocodifica)</p>
            <div className="mt-3 divide-y divide-line">
              {enriched.map((t) => (
                <div key={t.id} className="flex items-center justify-between py-2">
                  <span className="text-[13.5px] text-ink">{t.short_name}</span>
                  <span className="flex items-center gap-3">
                    <span className="num text-[12.5px] text-faint">{s.by_tribunale.find((b) => b.id === t.id)?.count ?? 0} in asta</span>
                    {me?.is_admin && <Toggle checked onChange={() => setActive.mutate({ id: t.id, active: false })} label={`Disattiva ${t.short_name}`} />}
                  </span>
                </div>
              ))}
            </div>
            {me?.is_admin && (
              <select
                className="mt-3 h-9 w-full rounded-xl bg-surface-2 px-3 text-[13px] text-ink"
                value=""
                onChange={(e) => e.target.value && setActive.mutate({ id: Number(e.target.value), active: true })}
              >
                <option value="">Attiva un altro tribunale…</option>
                {trib.data
                  ?.filter((t) => !t.active_for_enrichment)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.short_name}
                    </option>
                  ))}
              </select>
            )}
          </Card>
        </div>
      )}

      <h2 className="mt-12 mb-4 font-serif text-[22px] text-ink">Esecuzioni</h2>
      <Card className="overflow-hidden">
        {runs.data?.length === 0 && <p className="p-6 text-[13.5px] text-muted">Nessuna esecuzione registrata.</p>}
        <div className="divide-y divide-line">
          {runs.data?.map((r, i) => (
            <motion.details key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }} className="group px-5 py-3.5">
              <summary className="flex cursor-pointer list-none items-center gap-3">
                {r.status === "ok" ? (
                  r.errors?.length ? <AlertTriangle className="size-4 text-warn" /> : <CheckCircle2 className="size-4 text-ok" />
                ) : r.status === "running" ? (
                  <Loader2 className="size-4 animate-spin text-gold" />
                ) : (
                  <XCircle className="size-4 text-bad" />
                )}
                <span className="text-[13.5px] font-medium capitalize text-ink">{r.kind}</span>
                {r.scope && <Badge>{r.scope}</Badge>}
                <span className="text-[12.5px] text-muted">{dateTime(r.started_at)}</span>
                <span className="ml-auto text-[12px] text-faint">{duration(r)}</span>
              </summary>
              <div className="mt-3 flex flex-wrap gap-2 pl-7">
                {Object.entries(r.counts ?? {})
                  .sort(([a], [b]) => (KEY_COUNTS.indexOf(a) + 1 || 99) - (KEY_COUNTS.indexOf(b) + 1 || 99))
                  .map(([k, v]) => (
                    <span key={k} className="rounded-lg bg-surface-2/70 px-2 py-1 text-[11.5px] text-muted">
                      {k.replace(/_/g, " ")} <b className="num text-ink">{v}</b>
                    </span>
                  ))}
              </div>
              {!!r.errors?.length && (
                <pre className="scroll-thin mt-3 ml-7 max-h-60 overflow-auto rounded-xl bg-surface-2 p-3 font-mono text-[11.5px] whitespace-pre-wrap text-bad">
                  {r.errors.join("\n")}
                </pre>
              )}
            </motion.details>
          ))}
        </div>
      </Card>
    </Page>
  );
}
