import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AuthLayout } from "@/components/AuthLayout";
import { Button, Field, Input } from "@/components/ui";
import { post } from "@/lib/api";
import type { User } from "@/lib/types";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "forgot" | "sent">("login");
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation();
  const login = useMutation({
    mutationFn: () => post<User>("/auth/login", { email, password }),
    onSuccess: (u) => {
      qc.setQueryData(["me"], u);
      nav((loc.state as { from?: string } | null)?.from ?? "/", { replace: true });
    },
  });
  const forgot = useMutation({ mutationFn: () => post("/auth/forgot", { email }), onSuccess: () => setMode("sent") });

  if (mode === "sent") {
    return (
      <AuthLayout>
        <h1 className="font-serif text-[38px] leading-tight tracking-tight text-ink">Controlla l'email</h1>
        <p className="mt-4 text-[14px] leading-relaxed text-muted">
          Se <span className="text-ink">{email}</span> è registrato, riceverai a breve un link per scegliere una nuova password. Se non arriva entro
          qualche minuto, chiedi all'amministratore dello studio: può mandarti il link dalla pagina Admin.
        </p>
        <button type="button" onClick={() => setMode("login")} className="mt-10 cursor-pointer text-[13.5px] font-medium text-ink hover:underline">
          Torna all'accesso
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="font-serif text-[38px] leading-tight tracking-tight text-ink">{mode === "login" ? "Accedi" : "Password dimenticata"}</h1>
      <p className="mt-2 text-[14px] text-muted">{mode === "login" ? "Area riservata allo studio." : "Ti mandiamo un link per sceglierne una nuova."}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === "login") login.mutate();
          else forgot.mutate();
        }}
        className="mt-12 space-y-8"
      >
        <Field label="Email">
          <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="!h-11 text-[15px]" />
        </Field>
        {mode === "login" && (
          <Field label="Password">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="!h-11 text-[15px]" />
          </Field>
        )}
        {(mode === "login" ? login.error : forgot.error) && (
          <p className="text-[13px] text-bad">{((mode === "login" ? login.error : forgot.error) as Error).message}</p>
        )}
        <div className="flex items-center justify-between gap-6">
          {mode === "login" ? (
            <Button type="submit" variant="primary" size="lg" loading={login.isPending} iconRight={!login.isPending ? <ArrowRight className="size-4" /> : undefined}>
              Entra
            </Button>
          ) : (
            <Button type="submit" variant="primary" size="lg" loading={forgot.isPending}>
              Mandami il link
            </Button>
          )}
          <button type="button" onClick={() => setMode(mode === "login" ? "forgot" : "login")} className="cursor-pointer text-[13px] text-muted hover:text-ink">
            {mode === "login" ? "Password dimenticata?" : "Torna all'accesso"}
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
