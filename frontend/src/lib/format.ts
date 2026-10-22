// Italian locale throughout: € 125.000, gg/mm/aaaa, tabular figures in the UI.

const eur0 = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });

export function eur(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `€ ${eur0.format(Math.round(v))}`;
}

export function eurShort(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  if (v >= 1_000_000) return `€ ${num1.format(v / 1_000_000)} mln`;
  if (v >= 10_000) return `€ ${eur0.format(Math.round(v / 1000))}k`;
  return eur(v);
}

export function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined) return "—";
  return `${v.toLocaleString("it-IT", { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;
}

export function mq(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${num1.format(v)} m²`;
}

function d(v: string | Date): Date {
  return typeof v === "string" ? new Date(v) : v;
}

export function date(v: string | null | undefined): string {
  if (!v) return "—";
  return d(v).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Rome" });
}

export function dateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const x = d(v);
  return `${date(v)} ore ${x.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" })}`;
}

export function dateLong(v: string | null | undefined): string {
  if (!v) return "—";
  return d(v).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Rome" });
}

export function relative(v: string | null | undefined, now = new Date()): string {
  if (!v) return "—";
  const ms = d(v).getTime() - now.getTime();
  const days = Math.round(ms / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat("it-IT", { numeric: "auto" });
  if (Math.abs(days) >= 1) return rtf.format(days, "day");
  const hours = Math.round(ms / 3_600_000);
  if (Math.abs(hours) >= 1) return rtf.format(hours, "hour");
  return rtf.format(Math.round(ms / 60_000), "minute");
}

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  past: boolean;
  urgent: boolean;
}

export function countdown(v: string | null | undefined, now = new Date()): Countdown | null {
  if (!v) return null;
  const ms = d(v).getTime() - now.getTime();
  const past = ms < 0;
  const abs = Math.abs(ms);
  return {
    days: Math.floor(abs / 86_400_000),
    hours: Math.floor((abs % 86_400_000) / 3_600_000),
    minutes: Math.floor((abs % 3_600_000) / 60_000),
    past,
    urgent: !past && ms < 7 * 86_400_000,
  };
}

export function bytes(v: number | null | undefined): string {
  if (!v) return "";
  if (v > 1_000_000) return `${num1.format(v / 1_000_000)} MB`;
  return `${Math.max(1, Math.round(v / 1000))} KB`;
}

export function titleCase(s: string | null | undefined): string {
  if (!s) return "";
  return s.toLowerCase().replace(/(^|[\s'(-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
}
