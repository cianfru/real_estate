import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Page } from "@/components/AppShell";
import { Badge, Button, Card, Empty, Field, IconButton, Input, Spinner, Textarea, cx } from "@/components/ui";
import { api, del, post, put } from "@/lib/api";
import { date, eur } from "@/lib/format";
import { label, useMeta } from "@/lib/hooks";
import type { Cliente } from "@/lib/types";

const TONE: Record<string, "neutral" | "gold" | "ok" | "bad"> = {
  in_valutazione: "neutral",
  offerta_presentata: "gold",
  aggiudicato: "ok",
  scartato: "bad",
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
      subtitle="Solo un nome interno e note libere. Nessun dato fiscale."
      actions={
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
          Nuovo cliente
        </Button>
      }
    >
      {isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <Card>
          <Empty icon={<Users className="size-5" />} title="Nessun cliente">
            Crea un cliente qui o collegalo direttamente dalla scheda di un immobile.
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
          <Card className="h-fit p-2">
            {data.map((c) => (
              <button
                key={c.id}
                onClick={() => setParams({ id: String(c.id) })}
                className={cx(
                  "flex w-full cursor-pointer items-center justify-between rounded-xl px-3.5 py-3 text-left transition-colors",
                  c.id === selected ? "bg-surface-2" : "hover:bg-surface-2/60",
                )}
              >
                <span className="truncate text-[14px] font-medium text-ink">{c.display_name}</span>
                <span className="num text-[12px] text-faint">{c.lotti.length}</span>
              </button>
            ))}
          </Card>
          {current && (
            <motion.div key={current.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="p-7">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-serif text-[28px] leading-tight text-ink">{current.display_name}</h2>
                    <p className="mt-1 text-[12.5px] text-faint">Cliente dal {date(current.created_at)}</p>
                  </div>
                  <div className="flex gap-1">
                    <IconButton label="Modifica" icon={<Pencil className="size-4" />} onClick={() => setEditing(current)} />
                    <IconButton
                      label="Elimina"
                      icon={<Trash2 className="size-4" />}
                      onClick={() => confirm(`Eliminare ${current.display_name}? I collegamenti agli immobili verranno rimossi.`) && remove.mutate(current.id)}
                    />
                  </div>
                </div>
                {current.notes && <p className="mt-4 whitespace-pre-line rounded-2xl bg-surface-2/70 p-4 text-[14px] text-ink/90">{current.notes}</p>}
                <h3 className="mt-8 mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">Immobili collegati</h3>
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
                          </p>
                        </div>
                        <p className="num text-[14px] font-semibold text-ink">{eur(l.prezzo_base)}</p>
                        <Badge tone={TONE[l.status] ?? "neutral"}>{label(meta?.cliente_status, l.status)}</Badge>
                      </Link>
                    ))}
                  </div>
                )}
              </Card>
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <Card className="p-7 shadow-float">
          <h2 className="font-serif text-[24px] text-ink">{cliente ? "Modifica cliente" : "Nuovo cliente"}</h2>
          <form
            className="mt-5 space-y-4"
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
            <div className="flex justify-end gap-2">
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
