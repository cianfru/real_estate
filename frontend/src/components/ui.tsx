// Design language: typographic and borderless. No pills, chips, switches or boxed badges:
// actions are text, selection is weight + a fine gold underline, inputs keep only a baseline.
import { motion, type HTMLMotionProps } from "framer-motion";
import { clsx } from "clsx";
import { Loader2 } from "lucide-react";
import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

export const cx = clsx;

type BtnVariant = "primary" | "secondary" | "ghost" | "gold" | "danger";

const btnStyles: Record<BtnVariant, string> = {
  primary: "text-ink font-semibold",
  secondary: "text-ink font-medium",
  ghost: "text-muted font-medium hover:text-ink",
  gold: "text-gold font-semibold",
  danger: "text-bad font-medium",
};

interface ButtonProps extends HTMLMotionProps<"button"> {
  variant?: BtnVariant;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
}

/** A text action. Hover draws a hairline underline; there is no box around it. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, iconRight, loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      disabled={disabled || loading}
      className={cx(
        "group/btn inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap py-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "text-[13px]" : size === "lg" ? "text-[17px]" : "text-[14px]",
        btnStyles[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-[1em] animate-spin" /> : icon}
      {children !== undefined && (
        <span className="underline decoration-transparent decoration-1 underline-offset-[5px] transition-[text-decoration-color] group-hover/btn:decoration-current/40">
          {children as ReactNode}
        </span>
      )}
      {iconRight}
    </motion.button>
  );
});

export function IconButton({ label, className, ...rest }: ButtonProps & { label: string }) {
  return (
    <Button
      variant="ghost"
      aria-label={label}
      title={label}
      className={cx("!px-0 justify-center [&_svg]:transition-colors", "size-8", className)}
      {...rest}
    />
  );
}

const fieldBase =
  "w-full rounded-none border-0 border-b border-line-strong bg-transparent px-0 text-[14px] text-ink outline-none transition-colors placeholder:text-faint hover:border-faint focus:border-ink";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(fieldBase, "h-10", className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        fieldBase,
        "h-10 cursor-pointer appearance-none pr-6",
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2398a3ad%22 stroke-width=%222.5%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[right_2px_center] bg-no-repeat",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(fieldBase, "resize-y py-2 leading-relaxed", className)} {...rest} />;
}

/** A floating surface (only used over the map and for dialogs). No border. */
export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("rounded-xl bg-surface shadow-soft", className)} {...rest}>
      {children}
    </div>
  );
}

type Tone = "neutral" | "gold" | "ok" | "warn" | "bad" | "navy";
const toneText: Record<Tone, string> = {
  neutral: "text-muted",
  gold: "text-gold",
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
  navy: "text-navy",
};

/** Status as small-caps text, no background. */
export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.09em]", toneText[tone], className)}>
      {children}
    </span>
  );
}

/** Inline list separated by thin middots. */
export function Inline({ children, className }: { children: ReactNode[]; className?: string }) {
  const items = children.filter(Boolean);
  return (
    <span className={cx("inline-flex flex-wrap items-center gap-x-2 gap-y-1", className)}>
      {items.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {i > 0 && <span className="text-faint/70">·</span>}
          {c}
        </span>
      ))}
    </span>
  );
}

/** A selectable word: weight and a fine gold underline when active. */
export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "cursor-pointer py-1 text-[13.5px] underline decoration-2 underline-offset-[7px] transition-colors",
        active ? "font-semibold text-ink decoration-gold" : "text-muted decoration-transparent hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/** Tabs with a sliding hairline under the active one. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  const id = options.map((x) => x.value).join();
  return (
    <div className="no-scrollbar -mb-1 inline-flex max-w-full gap-5 overflow-x-auto pb-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            "relative shrink-0 cursor-pointer pb-1.5 text-[13.5px] whitespace-nowrap transition-colors",
            value === o.value ? "font-semibold text-ink" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
          {value === o.value && (
            <motion.span layoutId={`seg-${id}`} className="absolute inset-x-0 -bottom-px h-[2px] bg-gold" transition={{ type: "spring", stiffness: 500, damping: 38 }} />
          )}
        </button>
      ))}
    </div>
  );
}

/** On/off as a small mark: a gold dot when on, a faint dot when off. No switch track. */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="grid size-5 shrink-0 cursor-pointer place-items-center"
    >
      <motion.span
        animate={{ scale: checked ? 1 : 0.7 }}
        transition={{ type: "spring", stiffness: 600, damping: 30 }}
        className={cx("size-2.5 rounded-full transition-colors", checked ? "bg-gold" : "bg-line-strong")}
      />
    </button>
  );
}

/** A full-width row that toggles an option: title + hint on the left, the dot on the right. */
export function OptionRow({ title, hint, checked, onChange }: { title: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} aria-pressed={checked} className="group flex w-full cursor-pointer items-center justify-between gap-4 py-2.5 text-left">
      <span>
        <span className={cx("block text-[13.5px] transition-colors", checked ? "font-semibold text-ink" : "text-ink/80 group-hover:text-ink")}>{title}</span>
        {hint && <span className="block text-[11.5px] text-faint">{hint}</span>}
      </span>
      <span className={cx("size-2.5 shrink-0 rounded-full transition-colors", checked ? "bg-gold" : "bg-line-strong")} />
    </button>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">{children}</h3>
      {action}
    </div>
  );
}

export function Rule({ className }: { className?: string }) {
  return <div className={cx("h-px bg-line", className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("size-5 animate-spin text-faint", className)} />;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon && <div className="mb-4 text-faint">{icon}</div>}
      <p className="font-serif text-xl text-ink">{title}</p>
      {children && <div className="mt-1.5 max-w-sm text-[13.5px] text-muted">{children}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[11.5px] text-faint">{hint}</span>}
    </label>
  );
}
