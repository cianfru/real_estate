import { motion } from "framer-motion";
import { Bookmark, LogOut, Map, Moon, Settings2, Sun, Users } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useLogout, useMe, useTheme } from "@/lib/hooks";
import { Logo } from "./Logo";
import { IconButton, cx } from "./ui";

const NAV = [
  { to: "/", label: "Mappa", icon: Map, end: true },
  { to: "/ricerche", label: "Ricerche", icon: Bookmark },
  { to: "/clienti", label: "Clienti", icon: Users },
  { to: "/admin", label: "Admin", icon: Settings2 },
];

export function TopBar({ floating }: { floating?: boolean }) {
  const { data: me } = useMe();
  const { theme, toggle } = useTheme();
  const logout = useLogout();
  return (
    <header
      className={cx(
        "no-print z-40 flex h-14 items-center gap-3 px-3 sm:px-4",
        floating ? "glass hairline absolute top-3 right-3 left-3 rounded-2xl shadow-soft" : "glass sticky top-0 border-b border-line",
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
      <nav className="mx-auto flex items-center gap-0.5 rounded-full bg-surface-2/80 p-1">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="relative">
            {({ isActive }) => (
              <span
                className={cx(
                  "relative flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors",
                  isActive ? "text-ink" : "text-muted hover:text-ink",
                )}
              >
                {isActive && (
                  <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-full bg-surface shadow-soft" transition={{ type: "spring", stiffness: 500, damping: 38 }} />
                )}
                <Icon className="relative size-4" />
                <span className="relative hidden md:inline">{label}</span>
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="flex shrink-0 items-center gap-1">
        <IconButton label={theme === "dark" ? "Tema chiaro" : "Tema scuro"} icon={theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />} onClick={toggle} />
        {me && (
          <span className="hidden items-center gap-2 pl-1 lg:flex">
            <span className="grid size-8 place-items-center rounded-full bg-gold-soft text-[12px] font-semibold text-gold">
              {me.name.slice(0, 1).toUpperCase()}
            </span>
          </span>
        )}
        <IconButton label="Esci" icon={<LogOut className="size-4" />} onClick={logout} />
      </div>
    </header>
  );
}

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-full">
      <TopBar />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-8 sm:py-14">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-[34px] leading-tight tracking-tight text-ink">{title}</h1>
            {subtitle && <p className="mt-1.5 text-[14.5px] text-muted">{subtitle}</p>}
          </div>
          {actions}
        </div>
        {children}
      </main>
    </div>
  );
}
