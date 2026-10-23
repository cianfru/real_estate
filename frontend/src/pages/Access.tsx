import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AuthLayout } from "@/components/AuthLayout";
import { Button, Field, Input, Spinner } from "@/components/ui";
import { api, post } from "@/lib/api";
import type { TokenInfo, User } from "@/lib/types";

/** /accesso/:token — the link from an invitation or a password reset. */
export default function Access() {
  const { token = "" } = useParams();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();
  const info = useQuery({ queryKey: ["token", token], queryFn: () => api<TokenInfo>(`/auth/token/${token}`), retry: false });
  const save = useMutation({
    mutationFn: () => post<User>(`/auth/token/${token}`, { password }),
    onSuccess: (u) => {
      qc.setQueryData(["me"], u);
      nav("/", { replace: true });
    },
  });

  if (info.isLoading)
    return (
      <AuthLayout>
        <Spinner />
      </AuthLayout>
    );
  if (info.error || !info.data)
    return (
      <AuthLayout>
        <h1 className="font-serif text-[38px] leading-tight tracking-tight text-ink">Link non valido</h1>
        <p className="mt-4 text-[14px] leading-relaxed text-muted">
          Il link è scaduto o è già stato usato. Chiedine uno nuovo all'amministratore dello studio, oppure usa «Password dimenticata?» nella pagina di
          accesso.
        </p>
        <Link to="/login" className="mt-10 inline-block text-[13.5px] font-medium text-ink hover:underline">
          Vai all'accesso
        </Link>
      </AuthLayout>
    );

  const d = info.data;
  return (
    <AuthLayout>
      <h1 className="font-serif text-[38px] leading-tight tracking-tight text-ink">{d.purpose === "invite" ? `Ciao, ${d.name.split(" ")[0]}` : "Nuova password"}</h1>
      <p className="mt-2 text-[14px] text-muted">
        {d.purpose === "invite" ? "Scegli la password per accedere." : "Scegli una nuova password."} <span className="text-ink">{d.email}</span>
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (password !== repeat) return setMismatch(true);
          setMismatch(false);
          save.mutate();
        }}
        className="mt-12 space-y-8"
      >
        <input type="email" autoComplete="username" value={d.email} readOnly hidden />
        <Field label="Password" hint="Almeno 10 caratteri. Una frase breve è più sicura e più facile da ricordare.">
          <Input type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} className="!h-11 text-[15px]" />
        </Field>
        <Field label="Ripeti la password">
          <Input type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} className="!h-11 text-[15px]" />
        </Field>
        {mismatch && <p className="text-[13px] text-bad">Le due password non coincidono.</p>}
        {save.error && <p className="text-[13px] text-bad">{(save.error as Error).message}</p>}
        <Button type="submit" variant="primary" size="lg" loading={save.isPending} iconRight={!save.isPending ? <ArrowRight className="size-4" /> : undefined}>
          {d.purpose === "invite" ? "Entra" : "Salva ed entra"}
        </Button>
      </form>
    </AuthLayout>
  );
}
