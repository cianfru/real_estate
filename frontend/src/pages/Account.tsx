import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Page } from "@/components/AppShell";
import { Button, Field, Input, SectionTitle } from "@/components/ui";
import { post } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import type { User } from "@/lib/types";

export default function Account() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const change = useMutation({
    mutationFn: () => post<User>("/auth/password", { current_password: current, new_password: next }),
    onSuccess: (u) => {
      qc.setQueryData(["me"], u);
      setCurrent("");
      setNext("");
      setRepeat("");
    },
  });

  return (
    <Page title="Il tuo account" subtitle={me ? `${me.name} · ${me.email} · ${me.is_admin ? "amministratore" : "collaboratore"}` : undefined}>
      <section className="max-w-md">
        <SectionTitle>Cambia password</SectionTitle>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (next !== repeat) return setMismatch(true);
            setMismatch(false);
            change.mutate();
          }}
          className="mt-6 space-y-7"
        >
          <input type="email" autoComplete="username" value={me?.email ?? ""} readOnly hidden />
          <Field label="Password attuale">
            <Input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="Nuova password" hint="Almeno 10 caratteri.">
            <Input type="password" autoComplete="new-password" required minLength={10} value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Ripeti la nuova password">
            <Input type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </Field>
          {mismatch && <p className="text-[13px] text-bad">Le due password non coincidono.</p>}
          {change.error && <p className="text-[13px] text-bad">{(change.error as Error).message}</p>}
          {change.isSuccess && <p className="text-[13px] text-ok">Password cambiata. Le altre sessioni aperte sono state chiuse.</p>}
          <Button type="submit" variant="primary" loading={change.isPending}>
            Cambia password
          </Button>
        </form>
      </section>
    </Page>
  );
}
