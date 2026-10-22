import type { ReactNode } from "react";
import type { Filters as F } from "@/lib/filters";
import { emptyFilters } from "@/lib/filters";
import type { Meta } from "@/lib/types";
import { Button, Chip, Field, Input, OptionRow, Select } from "./ui";

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function num(v: string): number | undefined {
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return v.trim() === "" || Number.isNaN(n) ? undefined : n;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">{title}</p>
      {children}
    </div>
  );
}

const PRICE_PRESETS: [string, number | undefined, number | undefined][] = [
  ["< 50k", undefined, 50_000],
  ["50–150k", 50_000, 150_000],
  ["150–300k", 150_000, 300_000],
  ["> 300k", 300_000, undefined],
];

export function FiltersPanel({ f, set, meta }: { f: F; set: (f: F) => void; meta: Meta | undefined }) {
  const upd = (patch: Partial<F>) => set({ ...f, ...patch });
  const enriched = meta?.tribunali.filter((t) => t.active_for_enrichment) ?? [];
  const others = meta?.tribunali.filter((t) => !t.active_for_enrichment && t.active_lots > 0) ?? [];
  const otherSelected = f.tribunale.filter((id) => others.some((t) => t.id === id));

  return (
    <div className="space-y-7">
      <Group title="Tribunale">
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {enriched.map((t) => (
            <Chip key={t.id} active={f.tribunale.includes(t.id)} onClick={() => upd({ tribunale: toggle(f.tribunale, t.id) })}>
              {t.short_name}
            </Chip>
          ))}
        </div>
        {others.length > 0 && (
          <Select
            value=""
            onChange={(e) => e.target.value && upd({ tribunale: [...f.tribunale, Number(e.target.value)] })}
            aria-label="Altri tribunali"
          >
            <option value="">Altri tribunali in Italia…</option>
            {others
              .filter((t) => !f.tribunale.includes(t.id))
              .sort((a, b) => a.short_name.localeCompare(b.short_name))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.short_name} ({t.active_lots})
                </option>
              ))}
          </Select>
        )}
        {otherSelected.length > 0 && (
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {otherSelected.map((id) => (
              <Chip key={id} active onClick={() => upd({ tribunale: f.tribunale.filter((x) => x !== id) })}>
                {others.find((t) => t.id === id)?.short_name} ×
              </Chip>
            ))}
          </div>
        )}
      </Group>

      <Group title="Categoria">
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {Object.entries(meta?.categorie ?? {}).map(([k, v]) => (
            <Chip key={k} active={f.category.includes(k)} onClick={() => upd({ category: toggle(f.category, k) })}>
              {v}
            </Chip>
          ))}
        </div>
        <Select
          value=""
          onChange={(e) => e.target.value && upd({ tipologia: toggle(f.tipologia, e.target.value) })}
          aria-label="Tipologia"
        >
          <option value="">{f.tipologia.length ? "Aggiungi tipologia…" : "Tutte le tipologie"}</option>
          {Object.entries(meta?.tipologie ?? {})
            .filter(([k]) => !f.tipologia.includes(k))
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
        </Select>
        {f.tipologia.length > 0 && (
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {f.tipologia.map((k) => (
              <Chip key={k} active onClick={() => upd({ tipologia: f.tipologia.filter((x) => x !== k) })}>
                {meta?.tipologie[k] ?? k} ×
              </Chip>
            ))}
          </div>
        )}
      </Group>

      <Group title="Prezzo base">
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {PRICE_PRESETS.map(([l, a, b]) => (
            <Chip
              key={l}
              active={f.price_min === a && f.price_max === b}
              onClick={() =>
                f.price_min === a && f.price_max === b ? upd({ price_min: undefined, price_max: undefined }) : upd({ price_min: a, price_max: b })
              }
            >
              {l}
            </Chip>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-6">
          <Input inputMode="numeric" placeholder="Min €" value={f.price_min ?? ""} onChange={(e) => upd({ price_min: num(e.target.value) })} />
          <Input inputMode="numeric" placeholder="Max €" value={f.price_max ?? ""} onChange={(e) => upd({ price_max: num(e.target.value) })} />
        </div>
      </Group>

      <div className="grid grid-cols-2 gap-6">
        <Field label="Superficie min (m²)">
          <Input inputMode="numeric" value={f.surface_min ?? ""} onChange={(e) => upd({ surface_min: num(e.target.value) })} />
        </Field>
        <Field label="Comune">
          <Input value={f.comune ?? ""} placeholder="es. Padova" onChange={(e) => upd({ comune: e.target.value || undefined })} />
        </Field>
      </div>

      <Group title="Scadenza offerte">
        <div className="grid grid-cols-2 gap-6">
          <Input type="date" aria-label="dal" value={f.deadline_from ?? ""} onChange={(e) => upd({ deadline_from: e.target.value || undefined })} />
          <Input type="date" aria-label="al" value={f.deadline_to ?? ""} onChange={(e) => upd({ deadline_to: e.target.value || undefined })} />
        </div>
      </Group>

      <Group title="Occupazione">
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {Object.entries(meta?.occupazione ?? {})
            .filter(([k]) => k !== "NON_SPECIFICATA")
            .map(([k, v]) => (
              <Chip key={k} active={f.occupazione.includes(k)} onClick={() => upd({ occupazione: toggle(f.occupazione, k) })}>
                {v}
              </Chip>
            ))}
        </div>
      </Group>

      <Group title="Modalità di vendita">
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {Object.entries(meta?.modalita ?? {})
            .filter(([k]) => k !== "VENDPDO")
            .map(([k, v]) => (
              <Chip key={k} active={f.modalita.includes(k)} onClick={() => upd({ modalita: toggle(f.modalita, k) })}>
                {v}
              </Chip>
            ))}
        </div>
      </Group>

      <div>
        {(
          [
            ["Solo opportunità", "Sotto il valore medio della zona", !!f.opportunity, (v: boolean) => upd({ opportunity: v || undefined })],
            ["Solo con ribasso", "Prezzo sceso rispetto al primo esperimento", !!f.price_dropped, (v: boolean) => upd({ price_dropped: v || undefined })],
            ["Nuovi ultimi 7 giorni", "Pubblicati su PVP nell'ultima settimana", f.new_days === 7, (v: boolean) => upd({ new_days: v ? 7 : undefined })],
            ["Solo con posizione", "Esclude gli immobili non localizzati", !!f.has_coords, (v: boolean) => upd({ has_coords: v || undefined })],
            [
              "Includi conclusi",
              "Aggiudicati, deserti e non più pubblicati",
              f.status.length > 1,
              (v: boolean) => upd({ status: v ? ["active", "sold", "unknown", "withdrawn"] : ["active"] }),
            ],
          ] as [string, string, boolean, (v: boolean) => void][]
        ).map(([title, hint, val, on]) => (
          <OptionRow key={title} title={title} hint={hint} checked={val} onChange={on} />
        ))}
      </div>

      <Button variant="ghost" size="sm" onClick={() => set({ ...emptyFilters(), q: f.q })}>
        Azzera filtri
      </Button>
    </div>
  );
}
