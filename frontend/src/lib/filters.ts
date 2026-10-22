// The filter state mirrors backend `LottoFilters`; it lives in the URL so every view is linkable.

export type SortKey = "data_vendita" | "termine" | "prezzo_asc" | "prezzo_desc" | "ribasso" | "nuovi" | "superficie";

export interface Filters {
  q?: string;
  tribunale: number[];
  comune?: string;
  provincia: string[];
  category: string[];
  tipologia: string[];
  price_min?: number;
  price_max?: number;
  surface_min?: number;
  surface_max?: number;
  deadline_from?: string;
  deadline_to?: string;
  occupazione: string[];
  modalita: string[];
  status: string[];
  has_coords?: boolean;
  new_days?: number;
  price_dropped?: boolean;
  min_rounds?: number;
  polygon?: GeoJSON.Polygon;
}

export const SORTS: Record<SortKey, string> = {
  data_vendita: "Data vendita",
  termine: "Scadenza offerte",
  prezzo_asc: "Prezzo crescente",
  prezzo_desc: "Prezzo decrescente",
  ribasso: "Ribasso maggiore",
  nuovi: "Più recenti",
  superficie: "Superficie",
};

export const emptyFilters = (): Filters => ({
  tribunale: [],
  provincia: [],
  category: [],
  tipologia: [],
  occupazione: [],
  modalita: [],
  status: ["active"],
});

const LISTS = ["tribunale", "provincia", "category", "tipologia", "occupazione", "modalita", "status"] as const;
const NUMS = ["price_min", "price_max", "surface_min", "surface_max", "new_days", "min_rounds"] as const;
const STRS = ["q", "comune", "deadline_from", "deadline_to"] as const;
const BOOLS = ["has_coords", "price_dropped"] as const;

/** Query string for the API (repeated keys for lists). */
export function toQuery(f: Filters, extra: Record<string, string | number | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const k of LISTS) for (const v of f[k]) p.append(k, String(v));
  for (const k of NUMS) if (f[k] !== undefined && !Number.isNaN(f[k])) p.set(k, String(f[k]));
  for (const k of STRS) if (f[k]) p.set(k, f[k]!);
  for (const k of BOOLS) if (f[k] !== undefined) p.set(k, String(f[k]));
  if (f.polygon) p.set("polygon", JSON.stringify(f.polygon));
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== "") p.set(k, String(v));
  return p.toString();
}

/** Parse filters back from a URL query string (inverse of toQuery). */
export function fromQuery(search: string): Filters {
  const p = new URLSearchParams(search);
  const f = emptyFilters();
  for (const k of LISTS) {
    const vals = p.getAll(k);
    if (vals.length) (f as unknown as Record<string, unknown>)[k] = k === "tribunale" ? vals.map(Number) : vals;
  }
  for (const k of NUMS) if (p.has(k)) f[k] = Number(p.get(k));
  for (const k of STRS) if (p.get(k)) f[k] = p.get(k)!;
  for (const k of BOOLS) if (p.has(k)) f[k] = p.get(k) === "true";
  const poly = p.get("polygon");
  if (poly) {
    try {
      f.polygon = JSON.parse(poly) as GeoJSON.Polygon;
    } catch {
      /* ignore malformed polygon in URL */
    }
  }
  return f;
}

/** Saved-search criteria (backend JSON) -> Filters. */
export function fromCriteria(c: Record<string, unknown>): Filters {
  return { ...emptyFilters(), ...(c as Partial<Filters>) };
}

/** Filters -> backend criteria JSON (no undefined keys). */
export function toCriteria(f: Filters): Record<string, unknown> {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0)));
}

export function activeCount(f: Filters): number {
  let n = 0;
  for (const k of LISTS) if (k !== "status" && f[k].length) n++;
  if (f.status.length !== 1 || f.status[0] !== "active") n++;
  for (const k of NUMS) if (f[k] !== undefined) n++;
  for (const k of STRS) if (f[k]) n++;
  for (const k of BOOLS) if (f[k] !== undefined) n++;
  if (f.polygon) n++;
  return n;
}
