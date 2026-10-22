import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { BellPlus, ChevronDown, List, Map as MapIcon, PenLine, Scan, Search, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { TopBar } from "@/components/AppShell";
import { FiltersPanel } from "@/components/Filters";
import { LottoCard, useLotto } from "@/components/LottoCard";
import { MapLegend, MapView } from "@/components/MapView";
import { ResultList } from "@/components/ResultList";
import { Badge, Button, Card, Field, Input, Select, Toggle, cx } from "@/components/ui";
import { api, post } from "@/lib/api";
import { activeCount, fromQuery, SORTS, toCriteria, toQuery, type Filters, type SortKey } from "@/lib/filters";
import { relative } from "@/lib/format";
import { useMediaQuery, useMeta } from "@/lib/hooks";
import type { GeoCollection, LottiPage, LottoListItem, SavedSearch } from "@/lib/types";

const PAGE = 100;

export default function Explore() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => fromQuery(params.toString()), [params]);
  const sort = (params.get("sort") as SortKey) || "data_vendita";
  const selectedId = params.get("id") ? Number(params.get("id")) : null;
  const { data: meta } = useMeta();
  const desktop = useMediaQuery("(min-width: 1024px)");

  const [showFilters, setShowFilters] = useState(false);
  const [mobileView, setMobileView] = useState<"map" | "list">("map");
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [areaOn, setAreaOn] = useState(true);
  const [bbox, setBbox] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [focus, setFocus] = useState<{ lat: number; lon: number } | null>(null);
  const [q, setQ] = useState(filters.q ?? "");
  const deferredQ = useDeferredValue(q);

  const write = useCallback(
    (f: Filters, extra: { sort?: string; id?: number | null } = {}) => {
      const s = extra.sort ?? sort;
      const id = extra.id === undefined ? selectedId : extra.id;
      const qs = toQuery(f, { sort: s === "data_vendita" ? undefined : s, id: id ?? undefined });
      setParams(qs, { replace: true });
    },
    [setParams, sort, selectedId],
  );
  const setFilters = useCallback((f: Filters) => write(f), [write]);
  const select = useCallback((id: number | null) => write(filters, { id }), [write, filters]);

  useEffect(() => {
    const t = setTimeout(() => {
      if ((filters.q ?? "") !== deferredQ) setFilters({ ...filters, q: deferredQ || undefined });
    }, 300);
    return () => clearTimeout(t);
  }, [deferredQ, filters, setFilters]);

  const qs = toQuery(filters);
  const areaBbox = areaOn ? bbox ?? undefined : undefined;

  const list = useInfiniteQuery({
    queryKey: ["lotti", qs, sort, areaBbox],
    queryFn: ({ pageParam }) =>
      api<LottiPage>(`/lotti?${toQuery(filters, { sort, page: pageParam, page_size: PAGE, bbox: areaBbox })}`),
    initialPageParam: 0,
    getNextPageParam: (last) => ((last.page + 1) * last.page_size < last.total ? last.page + 1 : undefined),
    placeholderData: (prev) => prev,
  });
  const geo = useQuery({
    queryKey: ["geo", qs],
    queryFn: () => api<GeoCollection>(`/lotti/geojson?${qs}`),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  // Deep link (?id=…): centre the map on the lot once its card has loaded.
  const selected = useLotto(selectedId);
  const centred = useRef<number | null>(null);
  useEffect(() => {
    const d = selected.data;
    if (d && centred.current !== d.id && d.lat !== null && d.lon !== null) {
      centred.current = d.id;
      setFocus({ lat: d.lat, lon: d.lon });
    }
  }, [selected.data]);

  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const nFilters = activeCount(filters);

  const onSelect = useCallback(
    (lot: LottoListItem) => {
      select(lot.id);
      if (lot.lat !== null && lot.lon !== null) {
        centred.current = lot.id;
        setFocus({ lat: lot.lat, lon: lot.lon });
      }
      if (!desktop) setMobileView("map");
    },
    [select, desktop],
  );

  const panelVisible = desktop || mobileView === "list";

  return (
    <div className="relative h-full overflow-hidden">
      <MapView
        data={geo.data}
        hoveredId={hoveredId}
        selectedId={selectedId}
        onHover={setHoveredId}
        onSelect={(id) => select(id)}
        onBoundsChange={setBbox}
        drawing={drawing}
        polygon={filters.polygon}
        onPolygon={(p) => setFilters({ ...filters, polygon: p })}
        onDrawingEnd={() => setDrawing(false)}
        focus={focus}
        initialView="veneto"
      />
      <TopBar floating />

      {/* map tools */}
      <div className="absolute top-[76px] right-3 z-20 flex flex-col items-end gap-2">
        <div className="glass hairline flex items-center gap-1 rounded-full p-1 shadow-soft">
          <label className="flex cursor-pointer items-center gap-2 py-1 pr-1 pl-3 text-[12.5px] font-medium text-ink">
            <Scan className="size-3.5 text-muted" />
            Cerca in quest'area
            <Toggle checked={areaOn} onChange={setAreaOn} label="Cerca in quest'area" />
          </label>
        </div>
        {filters.polygon ? (
          <Button size="sm" variant="secondary" icon={<X className="size-3.5" />} onClick={() => setFilters({ ...filters, polygon: undefined })}>
            Rimuovi area disegnata
          </Button>
        ) : (
          <Button
            size="sm"
            variant={drawing ? "gold" : "secondary"}
            icon={<PenLine className="size-3.5" />}
            onClick={() => setDrawing(!drawing)}
          >
            {drawing ? "Clicca i vertici · doppio clic per chiudere" : "Disegna area"}
          </Button>
        )}
        {desktop && meta && (
          <div className="mt-1">
            <MapLegend labels={meta.categorie} />
          </div>
        )}
      </div>

      {/* results panel */}
      <AnimatePresence>
        {panelVisible && (
          <motion.section
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className={cx(
              "glass hairline absolute z-30 flex flex-col overflow-hidden shadow-float",
              desktop ? "top-[76px] bottom-3 left-3 w-[420px] rounded-3xl" : "inset-x-0 top-[72px] bottom-0 rounded-t-3xl",
            )}
          >
            <div className="space-y-3 px-4 pt-4 pb-2">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Cerca per comune, indirizzo, parola chiave o RGE"
                  className="!h-11 !rounded-2xl pl-9"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={showFilters ? "primary" : "secondary"}
                  icon={<SlidersHorizontal className="size-3.5" />}
                  onClick={() => setShowFilters(!showFilters)}
                >
                  Filtri
                  {nFilters > 0 && (
                    <span className="ml-0.5 grid size-5 place-items-center rounded-full bg-gold text-[11px] font-semibold text-[#14202b]">{nFilters}</span>
                  )}
                  <ChevronDown className={cx("size-3.5 transition-transform", showFilters && "rotate-180")} />
                </Button>
                <Button size="sm" variant="ghost" icon={<BellPlus className="size-3.5" />} onClick={() => setSaveOpen(true)}>
                  Salva
                </Button>
                <Select
                  value={sort}
                  onChange={(e) => write(filters, { sort: e.target.value })}
                  className="!ml-auto !h-8 !w-auto !rounded-full !text-[12.5px]"
                  aria-label="Ordina"
                >
                  {Object.entries(SORTS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <AnimatePresence initial={false}>
              {showFilters && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden border-y border-line"
                >
                  <div className="scroll-thin max-h-[52vh] overflow-y-auto px-4 py-4">
                    <FiltersPanel f={filters} set={setFilters} meta={meta} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-baseline justify-between px-5 pt-2 pb-2">
              <p className="text-[13px] text-muted">
                <span className="num font-semibold text-ink">{total.toLocaleString("it-IT")}</span> immobili
                {areaOn && <span className="text-faint"> nell'area visibile</span>}
              </p>
              {meta?.last_sync_at && <p className="text-[11px] text-faint">PVP aggiornato {relative(meta.last_sync_at)}</p>}
            </div>
            <div className="min-h-0 flex-1">
              <ResultList
                items={items}
                total={total}
                loading={list.isFetching}
                hasMore={!!list.hasNextPage}
                loadMore={() => list.fetchNextPage()}
                hoveredId={hoveredId}
                selectedId={selectedId}
                onHover={setHoveredId}
                onSelect={onSelect}
              />
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* property drawer */}
      <AnimatePresence>
        {selectedId !== null && (
          <motion.aside
            key="drawer"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            className={cx(
              "absolute z-40 overflow-hidden bg-surface shadow-float",
              desktop ? "top-[76px] right-3 bottom-3 w-[min(640px,calc(100vw-460px))] rounded-3xl hairline" : "inset-0",
            )}
          >
            <div className="scroll-thin h-full overflow-y-auto">
              <LottoCard id={selectedId} onClose={() => select(null)} />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* mobile switch */}
      {!desktop && selectedId === null && (
        <div className="absolute bottom-5 left-1/2 z-40 -translate-x-1/2">
          <Button variant="primary" className="shadow-float" icon={mobileView === "map" ? <List className="size-4" /> : <MapIcon className="size-4" />} onClick={() => setMobileView(mobileView === "map" ? "list" : "map")}>
            {mobileView === "map" ? `Elenco · ${total}` : "Mappa"}
          </Button>
        </div>
      )}

      <AnimatePresence>{saveOpen && <SaveSearchDialog filters={filters} onClose={() => setSaveOpen(false)} />}</AnimatePresence>
    </div>
  );
}

function SaveSearchDialog({ filters, onClose }: { filters: Filters; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [alert, setAlert] = useState(true);
  const save = useMutation({
    mutationFn: () => post<SavedSearch>("/saved-searches", { name, criteria: toCriteria(filters), alert_enabled: alert }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-searches"] });
      onClose();
    },
  });
  const n = activeCount(filters);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div initial={{ scale: 0.96, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 8 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-md">
        <Card className="p-7 shadow-float">
          <h2 className="font-serif text-[24px] text-ink">Salva ricerca</h2>
          <p className="mt-1 text-[13.5px] text-muted">
            {n > 0 ? `${n} filtri attivi` : "Nessun filtro: riceverai tutte le novità"}
            {filters.polygon && <Badge tone="gold" className="ml-2">area disegnata</Badge>}
          </p>
          <form
            className="mt-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) save.mutate();
            }}
          >
            <Field label="Nome">
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Trilocali Padova sotto 150k" />
            </Field>
            <label className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2/70 px-4 py-3">
              <span>
                <span className="block text-[13.5px] font-medium text-ink">Avvisi via email</span>
                <span className="block text-[12px] text-muted">Nuovi immobili, nuovi esperimenti e ribassi, ogni mattina</span>
              </span>
              <Toggle checked={alert} onChange={setAlert} label="Avvisi via email" />
            </label>
            {save.error && <p className="text-[13px] text-bad">{(save.error as Error).message}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={onClose}>
                Annulla
              </Button>
              <Button type="submit" variant="primary" loading={save.isPending} disabled={!name.trim()}>
                Salva
              </Button>
            </div>
          </form>
        </Card>
      </motion.div>
    </motion.div>
  );
}
