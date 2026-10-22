import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
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
    <div className="relative grid min-h-full place-items-center overflow-hidden px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(60% 50% at 20% 10%, rgb(224 179 29 / 0.16), transparent 60%), radial-gradient(50% 50% at 90% 90%, rgb(11 38 59 / 0.14), transparent 60%)",
        }}
      />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-[400px]"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark className="size-14" />
          <h1 className="mt-5 font-serif text-[34px] leading-tight tracking-tight text-ink">Legal Estate</h1>
          <p className="mt-1 text-[14px] text-muted">Aste immobiliari con tutela legale · area riservata</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate();
          }}
          className="glass hairline space-y-4 rounded-3xl p-7 shadow-float"
        >
          <Field label="Email">
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {login.error && <p className="text-[13px] text-bad">{(login.error as Error).message}</p>}
          <Button type="submit" variant="primary" className="w-full !h-11" loading={login.isPending} icon={!login.isPending ? <ArrowRight className="size-4" /> : undefined}>
            Accedi
          </Button>
        </form>
        <p className="mt-6 text-center text-[12px] text-faint">Dati dal Portale delle Vendite Pubbliche · Ministero della Giustizia</p>
      </motion.div>
    </div>
  );
}
