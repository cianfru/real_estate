import { motion, type HTMLMotionProps } from "framer-motion";
import { clsx } from "clsx";
import { Loader2 } from "lucide-react";
import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

export const cx = clsx;

type BtnVariant = "primary" | "secondary" | "ghost" | "gold" | "danger";

const btnStyles: Record<BtnVariant, string> = {
  primary: "bg-[#0b263b] text-[#f6f5f2] dark:bg-[#e9ecef] dark:text-[#0b1118] hover:opacity-90 shadow-soft",
  secondary: "bg-surface text-ink hairline hover:bg-surface-2 shadow-soft",
  ghost: "text-muted hover:text-ink hover:bg-surface-2",
  gold: "bg-gold text-[#14202b] hover:brightness-105 shadow-soft",
  danger: "text-bad hover:bg-bad/10",
};

interface ButtonProps extends HTMLMotionProps<"button"> {
  variant?: BtnVariant;
  size?: "sm" | "md";
  icon?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      whileHover={{ scale: disabled ? 1 : 1.02 }}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm",
        btnStyles[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children as ReactNode}
    </motion.button>
  );
});

export function IconButton({ label, className, ...rest }: ButtonProps & { label: string }) {
  return (
    <Button
      variant="ghost"
      aria-label={label}
      title={label}
      className={cx("!h-9 !w-9 !px-0", className)}
      {...rest}
    />
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cx(
        "h-10 w-full rounded-xl bg-surface-2 px-3 text-sm text-ink placeholder:text-faint outline-none transition",
        "border border-transparent focus:border-line-strong focus:bg-surface focus:ring-4 focus:ring-gold/15",
        className,
      )}
      {...rest}
    />
  );
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        "h-10 w-full appearance-none rounded-xl bg-surface-2 px-3 pr-8 text-sm text-ink outline-none border border-transparent focus:border-line-strong focus:ring-4 focus:ring-gold/15",
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2398a3ad%22 stroke-width=%222.5%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[right_10px_center] bg-no-repeat",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx(
        "w-full rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-ink placeholder:text-faint outline-none border border-transparent focus:border-line-strong focus:bg-surface focus:ring-4 focus:ring-gold/15 resize-y",
        className,
      )}
      {...rest}
    />
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("rounded-2xl bg-surface hairline shadow-soft", className)} {...rest}>
      {children}
    </div>
  );
}

type Tone = "neutral" | "gold" | "ok" | "warn" | "bad" | "navy";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  gold: "bg-gold-soft text-gold",
  ok: "bg-ok/12 text-ok",
  warn: "bg-warn/12 text-warn",
  bad: "bg-bad/12 text-bad",
  navy: "bg-navy/8 text-navy",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-5", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "h-8 rounded-full px-3 text-[13px] font-medium transition-colors cursor-pointer",
        active
          ? "bg-[#0b263b] text-[#f6f5f2] dark:bg-[#e9ecef] dark:text-[#0b1118]"
          : "bg-surface-2 text-muted hover:text-ink",
      )}
    >
      {children}
    </motion.button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-full bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            "relative h-7 rounded-full px-3 text-[12px] font-medium transition-colors cursor-pointer",
            value === o.value ? "text-ink" : "text-muted hover:text-ink",
          )}
        >
          {value === o.value && (
            <motion.span layoutId={`seg-${options.map((x) => x.value).join()}`} className="absolute inset-0 rounded-full bg-surface shadow-soft" transition={{ type: "spring", stiffness: 500, damping: 35 }} />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full transition-colors",
        checked ? "bg-ok" : "bg-line-strong",
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 600, damping: 35 }}
        className={cx("size-5 rounded-full bg-white shadow", checked ? "ml-[18px]" : "ml-0.5")}
      />
    </button>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{children}</h3>
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("size-5 animate-spin text-faint", className)} />;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon && <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-surface-2 text-faint">{icon}</div>}
      <p className="font-serif text-lg text-ink">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}
