import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Page } from "@/components/AppShell";
import { Button, Rule, SectionTitle, Segmented, Select, Spinner, cx } from "@/components/ui";
import { api, patch, post } from "@/lib/api";
import { dateTime, relative } from "@/lib/format";
import { label, useMe, useMeta } from "@/lib/hooks";
import type { AdminStats, IngestRun, TribunaleMeta } from "@/lib/types";

function duration(r: IngestRun): string {
  if (!r.finished_at) return "in corso";
  const s = Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000);
  return s > 90 ? `${Math.round(s / 60)} min` : `${s} s`;
}

const KIND: Record<string, string> = { sync: "Sincronizzazione", geocode: "Geocodifica", analytics: "Analisi di mercato", alerts: "Avvisi", history: "Storico" };
const KEY_COUNTS = ["list_rows", "vendite_created", "lotti_created", "details_fetched", "storico_rows", "history_rows", "opportunities", "lots_benchmarked", "event_new_lot", "event_new_round", "event_price_drop", "geocoded_nominatim", "geocoded_comune", "emails", "pvp_requests"];

function Figure({ label: l, value, sub, hero }: { label: string; value: string | number; sub?: string; hero?: boolean }) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">{l}</p>
      <p className={cx("mt-2 font-light leading-none tracking-[-0.02em] text-ink", hero ? "text-[52px]" : "text-[30px]")}>{typeof value === "number" ? value.toLocaleString("it-IT") : value}</p>
      {sub && <p className="mt-2 text-[12.5px] text-muted">{sub}</p>}
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
  const sync = useMutation({ mutationFn: () => post(`/admin/sync?scope=${scope}`), onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ["runs"] }), 800) });
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
  const events = Object.entries(s?.eventi_7d ?? {}).filter(([k]) => k !== "geocoded");

  return (
    <Page
      title="Amministrazione"
      subtitle={meta?.last_sync_at ? `Ultima sincronizzazione completata ${relative(meta.last_sync_at)}.` : "Nessuna sincronizzazione completata."}
      actions={
        me?.is_admin && (
          <div className="flex items-end gap-10">
            <Segmented value={scope} onChange={setScope} options={[{ value: "veneto", label: "Veneto" }, { value: "italy", label: "Italia" }]} />
            <Button variant="gold" loading={sync.isPending || running} onClick={() => sync.mutate()}>
              {running ? "Sincronizzazione in corso" : "Avvia la sincronizzazione"}
            </Button>
          </div>
        )
      }
    >
      {sync.error && <p className="mb-6 text-[13px] text-bad">{(sync.error as Error).message}</p>}
      {!s ? (
        <Spinner />
      ) : (
        <>
          <div className="grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr]">
            <Figure hero label="Immobili in asta" value={s.lotti_by_status.active ?? 0} sub={`${(s.vendite ?? 0).toLocaleString("it-IT")} esperimenti in archivio`} />
            <Figure label="Con posizione" value={s.active_with_coords} sub={`${s.approx_coords} approssimative, ${s.active_without_coords} da geocodificare`} />
            <Figure label="Con dettaglio completo" value={s.active_with_detail} sub="tribunali attivi e richieste manuali" />
          </div>

          <Rule className="my-14" />

          <div className="grid gap-14 lg:grid-cols-2">
            <section>
              <SectionTitle>Ultimi 7 giorni</SectionTitle>
              {events.length === 0 ? (
                <p className="text-[13.5px] text-faint">Nessuna variazione: le novità compaiono dalla seconda sincronizzazione.</p>
              ) : (
                <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3">
                  {events.map(([k, v]) => (
                    <div key={k}>
                      <dd className="num text-[26px] font-light text-ink">{v.toLocaleString("it-IT")}</dd>
                      <dt className="text-[12px] text-muted">{label(meta?.eventi, k)}</dt>
                    </div>
                  ))}
                </dl>
              )}
            </section>
            <section>
              <SectionTitle>Tribunali con dettaglio, storico e geocodifica</SectionTitle>
              <ul className="divide-y divide-line">
                {enriched.map((t) => (
                  <li key={t.id} className="flex items-baseline justify-between py-2.5">
                    <span className="text-[14.5px] text-ink">{t.short_name}</span>
                    <span className="flex items-baseline gap-6">
                      <span className="num text-[12.5px] text-faint">{s.by_tribunale.find((b) => b.id === t.id)?.count ?? 0} in asta</span>
                      {me?.is_admin && (
                        <button className="cursor-pointer text-[12.5px] text-muted hover:text-bad" onClick={() => setActive.mutate({ id: t.id, active: false })}>
                          Disattiva
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {me?.is_admin && (
                <Select className="mt-4" value="" onChange={(e) => e.target.value && setActive.mutate({ id: Number(e.target.value), active: true })}>
                  <option value="">Attiva un altro tribunale…</option>
                  {trib.data
                    ?.filter((t) => !t.active_for_enrichment)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.short_name}
                      </option>
                    ))}
                </Select>
              )}
            </section>
          </div>
        </>
      )}

      <Rule className="my-14" />

      <SectionTitle>Esecuzioni</SectionTitle>
      {runs.data?.length === 0 && <p className="text-[13.5px] text-muted">Nessuna esecuzione registrata.</p>}
      <ul className="divide-y divide-line">
        {runs.data?.map((r) => (
          <li key={r.id}>
            <details className="group py-3.5">
              <summary className="grid cursor-pointer list-none grid-cols-[10px_1fr_auto] items-baseline gap-4">
                <span className={cx("size-2 self-center rounded-full", r.status === "ok" ? (r.errors?.length ? "bg-warn" : "bg-ok") : r.status === "running" ? "animate-pulse bg-gold" : "bg-bad")} />
                <span className="text-[14px] text-ink">
                  {KIND[r.kind] ?? r.kind}
                  {r.scope && <span className="ml-2 text-[12.5px] text-faint">{r.scope}</span>}
                  <span className="ml-3 text-[12.5px] text-muted">{dateTime(r.started_at)}</span>
                </span>
                <span className="num text-[12.5px] text-faint">{duration(r)}</span>
              </summary>
              <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 pl-[26px] text-[12px] text-muted">
                {Object.entries(r.counts ?? {})
                  .sort(([a], [b]) => (KEY_COUNTS.indexOf(a) + 1 || 99) - (KEY_COUNTS.indexOf(b) + 1 || 99))
                  .map(([k, v]) => (
                    <span key={k}>
                      {k.replace(/_/g, " ")} <span className="num text-ink">{v}</span>
                    </span>
                  ))}
              </p>
              {!!r.errors?.length && (
                <pre className="scroll-thin mt-3 ml-[26px] max-h-60 overflow-auto font-mono text-[11.5px] whitespace-pre-wrap text-bad">{r.errors.join("\n")}</pre>
              )}
            </details>
          </li>
        ))}
      </ul>
    </Page>
  );
}
