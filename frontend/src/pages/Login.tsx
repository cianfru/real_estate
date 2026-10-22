import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LogoMark } from "@/components/Logo";
import { Button, Field, Input } from "@/components/ui";
import { post } from "@/lib/api";
import type { User } from "@/lib/types";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-[#0b263b] lg:block">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: "radial-gradient(70% 60% at 25% 20%, rgb(224 179 29 / 0.18), transparent 60%)" }}
        />
        <div className="relative flex h-full flex-col justify-between p-14 text-[#f6f5f2]">
          <LogoMark className="size-11" />
          <div>
            <p className="max-w-md font-serif text-[44px] leading-[1.08] tracking-tight">Aste immobiliari, con il rigore di uno studio legale.</p>
            <p className="mt-5 max-w-sm text-[14px] leading-relaxed text-[#f6f5f2]/60">
              Ogni asta giudiziaria pubblicata sul Portale delle Vendite Pubbliche, letta zona per zona.
            </p>
          </div>
          <p className="text-[11px] tracking-[0.14em] text-[#e0b31d] uppercase">Legal Estate · Cadoneghe</p>
        </div>
      </div>
      <div className="grid place-items-center px-6 py-16">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="w-full max-w-[360px]">
          <LogoMark className="size-10 lg:hidden" />
          <h1 className="mt-6 font-serif text-[38px] leading-tight tracking-tight text-ink lg:mt-0">Accedi</h1>
          <p className="mt-2 text-[14px] text-muted">Area riservata allo studio.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              login.mutate();
            }}
            className="mt-12 space-y-8"
          >
            <Field label="Email">
              <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="!h-11 text-[15px]" />
            </Field>
            <Field label="Password">
              <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="!h-11 text-[15px]" />
            </Field>
            {login.error && <p className="text-[13px] text-bad">{(login.error as Error).message}</p>}
            <Button type="submit" variant="primary" size="lg" loading={login.isPending} iconRight={!login.isPending ? <ArrowRight className="size-4" /> : undefined}>
              Entra
            </Button>
          </form>
          <p className="mt-20 text-[11.5px] text-faint">Dati dal Portale delle Vendite Pubbliche, Ministero della Giustizia.</p>
        </motion.div>
      </div>
    </div>
  );
}
