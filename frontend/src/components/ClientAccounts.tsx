import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { IssuedLink } from "@/components/UsersAdmin";
import { Button, Field, Input, SectionTitle, cx } from "@/components/ui";
import { del, patch, post } from "@/lib/api";
import { relative } from "@/lib/format";
import type { Cliente, PasswordLink } from "@/lib/types";

/** Logins of one client to their area (/portale). */
export function ClientAccounts({ cliente }: { cliente: Cliente }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [issued, setIssued] = useState<PasswordLink | null>(null);
  const base = `/clienti/${cliente.id}/accounts`;
  const refresh = () => qc.invalidateQueries({ queryKey: ["clienti"] });
  const invite = useMutation({
    mutationFn: () => post<PasswordLink>(base, { name, email }),
    onSuccess: (r) => {
      setIssued(r);
      setName("");
      setEmail("");
      refresh();
    },
  });
  const link = useMutation({ mutationFn: (uid: number) => post<PasswordLink>(`${base}/${uid}/link`), onSuccess: setIssued });
  const toggle = useMutation({ mutationFn: ({ uid, active }: { uid: number; active: boolean }) => patch(`${base}/${uid}`, { is_active: active }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (uid: number) => del(`${base}/${uid}`), onSuccess: refresh });
  const error = (invite.error ?? link.error ?? toggle.error ?? remove.error) as Error | null;

  return (
    <section className="mt-12">
      <SectionTitle>Area riservata del cliente</SectionTitle>
      <p className="mb-6 max-w-2xl text-[13.5px] leading-relaxed text-muted">
        Chi ha un accesso entra con email e password e vede solo gli immobili collegati a {cliente.display_name} e visibili, con lo stato e la nota per il
        cliente. Mai le note interne, gli altri clienti o i contatti.
      </p>

      {cliente.accounts.length > 0 && (
        <ul className="mb-6 divide-y divide-line">
          {cliente.accounts.map((a) => (
            <li key={a.id} className={cx("grid gap-x-6 gap-y-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-baseline", !a.is_active && "opacity-55")}>
              <div>
                <p className="text-[14px] text-ink">{a.name}</p>
                <p className="text-[12.5px] text-muted">{a.email}</p>
              </div>
              <p className="text-[12.5px] text-muted">
                <span className={cx("mr-3 text-[10.5px] font-semibold tracking-[0.12em] uppercase", a.pending_invite ? "text-gold" : "text-faint")}>
                  {!a.is_active ? "Disattivato" : a.pending_invite ? "Invito in attesa" : "Attivo"}
                </span>
                {a.is_active && !a.pending_invite && (a.last_login_at ? `ultimo accesso ${relative(a.last_login_at)}` : "mai entrato")}
              </p>
              <div className="flex flex-wrap gap-x-5 text-[12.5px] sm:justify-end">
                {a.is_active && (
                  <button type="button" className="cursor-pointer text-muted hover:text-ink" onClick={() => link.mutate(a.id)}>
                    {a.pending_invite ? "Nuovo invito" : "Link per nuova password"}
                  </button>
                )}
                <button type="button" className="cursor-pointer text-muted hover:text-ink" onClick={() => toggle.mutate({ uid: a.id, active: !a.is_active })}>
                  {a.is_active ? "Disattiva" : "Riattiva"}
                </button>
                <button
                  type="button"
                  className="cursor-pointer text-muted hover:text-bad"
                  onClick={() => window.confirm(`Eliminare l'accesso di ${a.name}? Nome ed email vengono cancellati.`) && remove.mutate(a.id)}
                >
                  Elimina
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          invite.mutate();
        }}
        className="grid items-end gap-x-8 gap-y-5 sm:grid-cols-[1fr_1.2fr_auto]"
      >
        <Field label="Nome e cognome">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Button type="submit" variant="gold" loading={invite.isPending}>
          {cliente.accounts.length ? "Aggiungi un accesso" : "Dai accesso al cliente"}
        </Button>
      </form>
      {error && <p className="mt-4 text-[13px] text-bad">{error.message}</p>}
      {issued && <IssuedLink issued={issued} onClose={() => setIssued(null)} />}
    </section>
  );
}
