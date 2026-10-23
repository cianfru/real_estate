import { motion } from "framer-motion";
import { LogOut, Moon, Sun, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useLogout, useMe, useTheme } from "@/lib/hooks";
import { Logo } from "./Logo";
import { IconButton, cx } from "./ui";

const NAV = [
  { to: "/", label: "Mappa", end: true },
  { to: "/mercato", label: "Mercato" },
  { to: "/ricerche", label: "Ricerche" },
  { to: "/clienti", label: "Clienti" },
  { to: "/admin", label: "Admin" },
];

export function TopBar({ floating }: { floating?: boolean }) {
  const { data: me } = useMe();
  const { theme, toggle } = useTheme();
  const logout = useLogout();
  const nav = useNavigate();
  return (
    <header
      className={cx(
        "no-print z-40 flex h-14 items-center gap-6 px-4 sm:px-6",
        floating ? "glass absolute top-3 right-3 left-3 rounded-xl shadow-soft" : "glass sticky top-0",
      )}
    >
      <NavLink to="/" className="shrink-0">
        <span className="hidden sm:inline">
          <Logo />
        </span>
        <span className="sm:hidden">
          <Logo compact />
        </span>
      </NavLink>
      <nav className="no-scrollbar mx-auto flex min-w-0 items-center gap-5 overflow-x-auto py-1 sm:gap-8">
        {NAV.map(({ to, label, end }) => (
          <NavLink key={to} to={to} end={end} className="relative">
            {({ isActive }) => (
              <span className={cx("relative block py-1.5 text-[13.5px] whitespace-nowrap transition-colors", isActive ? "font-semibold text-ink" : "text-muted hover:text-ink")}>
                {label}
                {isActive && (
                  <motion.span layoutId="nav-underline" className="absolute inset-x-0 -bottom-[3px] h-[2px] bg-gold" transition={{ type: "spring", stiffness: 500, damping: 38 }} />
                )}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="flex shrink-0 items-center gap-2">
        {me && (
          <NavLink to="/account" className={({ isActive }) => cx("hidden text-[13px] hover:text-ink lg:inline", isActive ? "text-ink" : "text-muted")}>
            {me.name}
          </NavLink>
        )}
        <span className="lg:hidden">
          <IconButton label="Il tuo account" icon={<UserRound className="size-4" />} onClick={() => nav("/account")} />
        </span>
        <IconButton label={theme === "dark" ? "Tema chiaro" : "Tema scuro"} icon={theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />} onClick={toggle} />
        <IconButton label="Esci" icon={<LogOut className="size-4" />} onClick={logout} />
      </div>
    </header>
  );
}

export function Page({ title, subtitle, actions, children, wide }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-full">
      <TopBar />
      <main className={cx("mx-auto px-5 py-12 sm:px-10 sm:py-16", wide ? "max-w-7xl" : "max-w-6xl")}>
        <div className="mb-12 flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="font-serif text-[40px] leading-[1.05] tracking-tight text-ink">{title}</h1>
            {subtitle && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">{subtitle}</p>}
          </div>
          {actions}
        </div>
        {children}
      </main>
    </div>
  );
}
