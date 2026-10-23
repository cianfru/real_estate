import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { Logo, LogoLockup } from "@/components/Logo";

/** The split screen of the signed-out pages: navy panel on the left, the form on the right. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-[#0b263b] lg:block">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: "radial-gradient(70% 60% at 25% 20%, rgb(224 179 29 / 0.18), transparent 60%)" }}
        />
        <div className="relative flex h-full flex-col justify-between p-14 text-[#f6f5f2]">
          <span />
          <div>
            <LogoLockup className="w-[380px] max-w-full" />
            <p className="mt-10 max-w-sm text-[14px] leading-relaxed text-[#f6f5f2]/60">
              Ogni asta giudiziaria pubblicata sul Portale delle Vendite Pubbliche, letta zona per zona.
            </p>
          </div>
          <p className="text-[11px] tracking-[0.14em] text-[#e0b31d] uppercase">Legal Estate · Cadoneghe</p>
        </div>
      </div>
      <div className="grid place-items-center px-6 py-16">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="w-full max-w-[360px]">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          {children}
          <p className="mt-20 text-[11.5px] text-faint">Dati dal Portale delle Vendite Pubbliche, Ministero della Giustizia.</p>
        </motion.div>
      </div>
    </div>
  );
}
