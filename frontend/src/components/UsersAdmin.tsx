import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button, Field, Input, OptionRow, SectionTitle, cx } from "@/components/ui";
import { api, patch, post } from "@/lib/api";
import { relative } from "@/lib/format";
import { useMe } from "@/lib/hooks";
import type { AdminUser, PasswordLink } from "@/lib/types";

/** Staff accounts: invite, send a new password link, make admin, deactivate. */
export function UsersAdmin() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api<AdminUser[]>("/admin/users") });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [issued, setIssued] = useState<PasswordLink | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-users"] });

  const invite = useMutation({
    mutationFn: () => post<PasswordLink>("/admin/users", { name, email, is_admin: isAdmin }),
    onSuccess: (r) => {
      setIssued(r);
      setName("");
      setEmail("");
      setIsAdmin(false);
      refresh();
    },
  });
  const link = useMutation({ mutationFn: (id: number) => post<PasswordLink>(`/admin/users/${id}/link`), onSuccess: (r) => setIssued(r) });
  const edit = useMutation({
    mutationFn: ({ id, ...body }: { id: number; is_admin?: boolean; is_active?: boolean }) => patch<AdminUser>(`/admin/users/${id}`, body),
    onSuccess: refresh,
  });
  const error = (invite.error ?? link.error ?? edit.error) as Error | null;

  return (
    <section>
      <SectionTitle>Persone dello studio</SectionTitle>
      <p className="mb-8 max-w-2xl text-[13.5px] leading-relaxed text-muted">
        Ogni persona riceve un link personale per scegliere la propria password: nessuno, nemmeno l'amministratore, conosce le password degli altri. Il link
        di invito vale 7 giorni, quello per una nuova password 24 ore, e funziona una volta sola.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          invite.mutate();
        }}
        className="grid items-end gap-x-8 gap-y-5 sm:grid-cols-[1fr_1.2fr] lg:grid-cols-[1fr_1.2fr_auto_auto]"
      >
        <Field label="Nome e cognome">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <div className="w-44">
          <OptionRow title="Amministratore" hint="invita, sincronizza" checked={isAdmin} onChange={setIsAdmin} />
        </div>
        <Button type="submit" variant="gold" loading={invite.isPending}>
          Invita
        </Button>
      </form>

      {error && <p className="mt-5 text-[13px] text-bad">{error.message}</p>}
      {issued && <IssuedLink issued={issued} onClose={() => setIssued(null)} />}

      <ul className="mt-10 divide-y divide-line">
        {users.data?.map((u) => {
          const self = u.id === me?.id;
          return (
            <li key={u.id} className={cx("grid gap-x-6 gap-y-1.5 py-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)] sm:items-baseline", !u.is_active && "opacity-55")}>
              <div>
                <p className="text-[14.5px] text-ink">
                  {u.name}
                  {self && <span className="ml-2 text-[12px] text-faint">tu</span>}
                </p>
                <p className="text-[12.5px] text-muted">{u.email}</p>
              </div>
              <p className="text-[12.5px] text-muted">
                <span className={cx("mr-3 text-[10.5px] font-semibold tracking-[0.12em] uppercase", u.pending_invite ? "text-gold" : "text-faint")}>
                  {!u.is_active ? "Disattivato" : u.pending_invite ? "Invito in attesa" : u.is_admin ? "Amministratore" : "Collaboratore"}
                </span>
                {u.is_active && !u.pending_invite && (u.last_login_at ? `ultimo accesso ${relative(u.last_login_at)}` : "mai entrato")}
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] sm:justify-end">
                {u.is_active && (
                  <button type="button" className="cursor-pointer text-muted hover:text-ink" onClick={() => link.mutate(u.id)}>
                    {u.pending_invite ? "Nuovo invito" : "Link per nuova password"}
                  </button>
                )}
                {!self && u.is_active && (
                  <button type="button" className="cursor-pointer text-muted hover:text-ink" onClick={() => edit.mutate({ id: u.id, is_admin: !u.is_admin })}>
                    {u.is_admin ? "Togli amministratore" : "Rendi amministratore"}
                  </button>
                )}
                {!self && (
                  <button
                    type="button"
                    className={cx("cursor-pointer", u.is_active ? "text-muted hover:text-bad" : "text-ink hover:underline")}
                    onClick={() => {
                      if (u.is_active && !window.confirm(`Disattivare ${u.name}? Non potrà più accedere finché non lo riattivi.`)) return;
                      edit.mutate({ id: u.id, is_active: !u.is_active });
                    }}
                  >
                    {u.is_active ? "Disattiva" : "Riattiva"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function IssuedLink({ issued, onClose }: { issued: PasswordLink; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const who = issued.user.name;
  return (
    <div className="mt-8 border-l-2 border-gold pl-5">
      <p className="text-[13.5px] text-ink">
        {issued.purpose === "invite" ? `Invito per ${who}` : `Link per la nuova password di ${who}`}
        <span className="text-muted">
          {issued.emailed
            ? `: inviato a ${issued.user.email}. Puoi anche copiarlo e mandarlo tu.`
            : ": l'invio di email non è configurato, copia il link e mandalo tu (email, WhatsApp)."}
        </span>
      </p>
      <p className="mt-2 font-mono text-[12px] break-all text-muted">{issued.link}</p>
      <div className="mt-3 flex gap-6 text-[13px]">
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-gold hover:underline"
          onClick={() => {
            void navigator.clipboard?.writeText(issued.link);
            setCopied(true);
          }}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copiato" : "Copia il link"}
        </button>
        <button type="button" className="cursor-pointer text-muted hover:text-ink" onClick={onClose}>
          Chiudi
        </button>
      </div>
    </div>
  );
}
