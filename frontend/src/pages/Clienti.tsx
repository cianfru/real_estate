import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Page } from "@/components/AppShell";
import { ClientAccounts } from "@/components/ClientAccounts";
import { Button, Card, Empty, Field, Input, Spinner, Textarea, cx } from "@/components/ui";
import { api, del, post, put } from "@/lib/api";
import { date, eur } from "@/lib/format";
import { label, useMeta } from "@/lib/hooks";
import type { Cliente } from "@/lib/types";

const TONE: Record<string, string> = {
  in_valutazione: "text-muted",
  offerta_presentata: "font-medium text-gold",
  aggiudicato: "font-medium text-ok",
  scartato: "text-faint",
};

export default function Clienti() {
  const qc = useQueryClient();
  const { data: meta } = useMeta();
  const [params, setParams] = useSearchParams();
  const { data, isLoading } = useQuery({ queryKey: ["clienti"], queryFn: () => api<Cliente[]>("/clienti") });
  const [editing, setEditing] = useState<Cliente | "new" | null>(null);
  const selected = Number(params.get("id")) || data?.[0]?.id || null;
  const current = data?.find((c) => c.id === selected) ?? null;

  const remove = useMutation({
    mutationFn: (id: number) => del(`/clienti/${id}`),
    onSuccess: () => {
      setParams({});
      qc.invalidateQueries({ queryKey: ["clienti"] });
    },
  });

  return (
    <Page
      title="Clienti"
      subtitle="Un nome interno, note libere e, se vuoi, l'accesso del cliente alla sua area riservata. Nessun dato fiscale."
      actions={
        <Button variant="gold" onClick={() => setEditing("new")}>
          Nuovo cliente
        </Button>
      }
    >
      {isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <Empty title="Nessun cliente">Crea un cliente qui o collegalo direttamente dalla scheda di un immobile.</Empty>
      ) : (
        <div className="grid gap-14 lg:grid-cols-[260px_1fr]">
          <nav className="h-fit">
            {data.map((c) => (
              <button
                key={c.id}
                onClick={() => setParams({ id: String(c.id) })}
                className={cx(
                  "relative flex w-full cursor-pointer items-baseline justify-between py-2.5 pl-4 text-left transition-colors",
                  c.id === selected ? "font-semibold text-ink" : "text-muted hover:text-ink",
                )}
              >
                <span className={cx("absolute top-2.5 bottom-2.5 left-0 w-[2px]", c.id === selected ? "bg-gold" : "bg-transparent")} />
                <span className="truncate text-[14.5px]">{c.display_name}</span>
                <span className="num text-[12px] font-normal text-faint">{c.lotti.length}</span>
              </button>
            ))}
          </nav>
          {current && (
            <motion.div key={current.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-serif text-[34px] leading-tight text-ink">{current.display_name}</h2>
                    <p className="mt-1 text-[12.5px] text-faint">Cliente dal {date(current.created_at)}</p>
                  </div>
                  <div className="flex gap-6">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(current)}>
                      Modifica
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => confirm(`Eliminare ${current.display_name}? I collegamenti agli immobili verranno rimossi.`) && remove.mutate(current.id)}
                    >
                      Elimina
                    </Button>
                  </div>
                </div>
                {current.notes && <p className="mt-5 max-w-[65ch] whitespace-pre-line font-serif text-[16px] leading-relaxed text-ink/85">{current.notes}</p>}
                <ClientAccounts cliente={current} />
                <h3 className="mt-12 mb-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">Immobili collegati</h3>
                {current.lotti.length === 0 ? (
                  <p className="text-[13.5px] text-muted">Nessun immobile. Collegali dalla scheda dell'immobile.</p>
                ) : (
                  <div className="divide-y divide-line">
                    {current.lotti.map((l) => (
                      <Link key={l.link_id} to={`/lotti/${l.lotto_id}`} className="group flex items-center gap-4 py-3.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-serif text-[16px] text-ink group-hover:text-gold">{l.titolo}</p>
                          <p className="text-[12.5px] text-muted">
                            {l.tribunale} · vendita {date(l.data_vendita)} · {label(meta?.status, l.lotto_status)}
                            {!l.nel_portale && <span className="ml-2 text-faint">· nascosto al cliente</span>}
                            {l.nel_portale && l.nota_cliente && <span className="ml-2 text-faint">· con nota per il cliente</span>}
                          </p>
                        </div>
                        <p className="num text-[14px] font-semibold text-ink">{eur(l.prezzo_base)}</p>
                        <span className={cx("w-36 text-right text-[12.5px]", TONE[l.status] ?? "text-muted")}>{label(meta?.cliente_status, l.status)}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </div>
      )}
      {editing && <ClienteDialog cliente={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(c) => setParams({ id: String(c.id) })} />}
    </Page>
  );
}

function ClienteDialog({ cliente, onClose, onSaved }: { cliente: Cliente | null; onClose: () => void; onSaved: (c: Cliente) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(cliente?.display_name ?? "");
  const [notes, setNotes] = useState(cliente?.notes ?? "");
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const save = useMutation({
    mutationFn: () =>
      cliente ? put<Cliente>(`/clienti/${cliente.id}`, { display_name: name, notes }) : post<Cliente>("/clienti", { display_name: name, notes }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["clienti"] });
      onSaved(c);
      onClose();
    },
  });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <Card className="p-9 shadow-float">
          <h2 className="font-serif text-[28px] text-ink">{cliente ? "Modifica cliente" : "Nuovo cliente"}</h2>
          <form
            className="mt-7 space-y-7"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) save.mutate();
            }}
          >
            <Field label="Nome interno" hint="Es. «Famiglia Rossi» o «Investitore A». Niente codici fiscali.">
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Note">
              <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Budget, zone di interesse, esigenze…" />
            </Field>
            <div className="flex justify-end gap-8">
              <Button type="button" variant="ghost" onClick={onClose}>
                Annulla
              </Button>
              <Button type="submit" variant="primary" loading={save.isPending} disabled={!name.trim()}>
                Salva
              </Button>
            </div>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
