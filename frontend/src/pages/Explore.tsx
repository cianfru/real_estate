import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Search } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { TopBar } from "@/components/AppShell";
import { FiltersPanel } from "@/components/Filters";
import { LottoCard, useLotto } from "@/components/LottoCard";
import { MapLegend, MapView, quantileBreaks, useZones } from "@/components/MapView";
import { ResultList } from "@/components/ResultList";
import { Button, Card, Field, Input, OptionRow, Rule, Select, cx } from "@/components/ui";
import { api, post } from "@/lib/api";
import { activeCount, fromQuery, SORTS, toCriteria, toQuery, type Filters, type SortKey } from "@/lib/filters";
import { relative } from "@/lib/format";
import { useMediaQuery, useMeta } from "@/lib/hooks";
import type { GeoCollection, LottiPage, LottoListItem, SavedSearch } from "@/lib/types";

const PAGE = 100;

function MapControl({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cx(
        "flex w-full cursor-pointer items-center justify-between gap-6 py-1.5 text-left text-[12.5px] transition-colors",
        on ? "font-semibold text-ink" : "text-muted hover:text-ink",
      )}
    >
      {children}
      <span className={cx("size-2 shrink-0 rounded-full transition-colors", on ? "bg-gold" : "bg-line-strong")} />
    </button>
  );
}

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
  const [zonesOn, setZonesOn] = useState(false);
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
      setParams(toQuery(f, { sort: s === "data_vendita" ? undefined : s, id: id ?? undefined }), { replace: true });
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
  const areaBbox = areaOn ? (bbox ?? undefined) : undefined;

  const list = useInfiniteQuery({
    queryKey: ["lotti", qs, sort, areaBbox],
    queryFn: ({ pageParam }) => api<LottiPage>(`/lotti?${toQuery(filters, { sort, page: pageParam, page_size: PAGE, bbox: areaBbox })}`),
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
  const zoneSegment = filters.segment[0] ?? (filters.category.includes("IMMOBILE_COMMERCIALE") ? "commerciale" : "residenziale");
  const zones = useZones(zoneSegment, zonesOn);
  const breaks = useMemo(() => quantileBreaks(zones.data?.features.map((f) => f.properties.median) ?? []), [zones.data]);

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
  const nOpp = useMemo(() => geo.data?.features.filter((f) => f.properties.o).length ?? 0, [geo.data]);

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
        zones={zonesOn ? zones.data : undefined}
        zoneBreaks={zonesOn ? breaks : undefined}
      />
      <TopBar floating />

      {/* map tools: plain text controls on one quiet surface */}
      <div className="absolute top-[76px] right-3 z-20 w-[228px] space-y-2">
        <div className="glass rounded-lg px-4 py-2.5 shadow-soft">
          <MapControl on={areaOn} onClick={() => setAreaOn(!areaOn)}>
            Elenco segue la mappa
          </MapControl>
          <MapControl on={zonesOn} onClick={() => setZonesOn(!zonesOn)}>
            Valori di zona
          </MapControl>
          <MapControl on={!!filters.opportunity} onClick={() => setFilters({ ...filters, opportunity: filters.opportunity ? undefined : true })}>
            Solo opportunità{nOpp ? <span className="num ml-auto pr-3 font-normal text-faint">{nOpp}</span> : null}
          </MapControl>
          <Rule className="my-1.5" />
          {filters.polygon ? (
            <button className="w-full cursor-pointer py-1.5 text-left text-[12.5px] font-semibold text-gold" onClick={() => setFilters({ ...filters, polygon: undefined })}>
              Rimuovi l'area disegnata
            </button>
          ) : (
            <button className={cx("w-full cursor-pointer py-1.5 text-left text-[12.5px]", drawing ? "font-semibold text-gold" : "text-muted hover:text-ink")} onClick={() => setDrawing(!drawing)}>
              {drawing ? "Clicca i vertici, doppio clic per chiudere" : "Disegna un'area"}
            </button>
          )}
        </div>
        {desktop && <MapLegend zoneBreaks={zonesOn ? breaks : undefined} />}
      </div>

      {/* results panel */}
      <AnimatePresence>
        {panelVisible && (
          <motion.section
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className={cx(
              "glass absolute z-30 flex flex-col overflow-hidden shadow-float",
              desktop ? "top-[76px] bottom-3 left-3 w-[432px] rounded-xl" : "inset-x-0 top-[72px] bottom-0 rounded-t-xl",
            )}
          >
            <div className="px-6 pt-6">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-0 size-4 -translate-y-1/2 text-faint" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Comune, indirizzo, parola chiave o RGE" className="!h-11 pl-7 text-[15px]" />
              </div>
              <div className="mt-3 flex items-center gap-6">
                <Button size="sm" variant={showFilters || nFilters ? "primary" : "secondary"} onClick={() => setShowFilters(!showFilters)}>
                  {showFilters ? "Chiudi filtri" : nFilters ? `Filtri · ${nFilters}` : "Filtri"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSaveOpen(true)}>
                  Salva ricerca
                </Button>
                <Select value={sort} onChange={(e) => write(filters, { sort: e.target.value })} className="!ml-auto !h-8 !w-auto !border-transparent !text-[13px] text-muted" aria-label="Ordina">
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
                  className="overflow-hidden"
                >
                  <div className="scroll-thin max-h-[54vh] overflow-y-auto px-6 pt-4 pb-6">
                    <FiltersPanel f={filters} set={setFilters} meta={meta} />
                  </div>
                  <Rule className="mx-6" />
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-baseline justify-between px-6 pt-4 pb-1">
              <p className="text-[13px] text-muted">
                <span className="num font-semibold text-ink">{total.toLocaleString("it-IT")}</span> immobili
                {areaOn && <span className="text-faint"> nell'area visibile</span>}
              </p>
              {meta?.last_sync_at && <p className="text-[11px] text-faint">PVP {relative(meta.last_sync_at)}</p>}
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
            initial={{ opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 32 }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            className={cx(
              "absolute z-40 overflow-hidden bg-surface shadow-float",
              desktop ? "top-[76px] right-3 bottom-3 w-[min(680px,calc(100vw-470px))] rounded-xl" : "inset-0",
            )}
          >
            <div className="scroll-thin h-full overflow-y-auto">
              <LottoCard id={selectedId} onClose={() => select(null)} />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* mobile switch: a quiet text bar, no pill */}
      {!desktop && selectedId === null && (
        <div className="glass absolute inset-x-0 bottom-0 z-40 flex justify-center gap-10 py-3.5 shadow-float">
          {(["map", "list"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setMobileView(v)}
              className={cx("cursor-pointer text-[14px] underline decoration-2 underline-offset-[7px]", mobileView === v ? "font-semibold text-ink decoration-gold" : "text-muted decoration-transparent")}
            >
              {v === "map" ? "Mappa" : `Elenco · ${total.toLocaleString("it-IT")}`}
            </button>
          ))}
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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ y: 8 }} animate={{ y: 0 }} exit={{ y: 8 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-md">
        <Card className="p-9 shadow-float">
          <h2 className="font-serif text-[28px] leading-tight text-ink">Salva la ricerca</h2>
          <p className="mt-2 text-[13.5px] text-muted">
            {n > 0 ? `${n} filtri attivi` : "Nessun filtro: riceverai tutte le novità"}
            {filters.polygon && " · area disegnata"}
          </p>
          <form
            className="mt-7 space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) save.mutate();
            }}
          >
            <Field label="Nome">
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Trilocali a Padova sotto 150.000 €" />
            </Field>
            <OptionRow title="Avvisi via email" hint="Nuovi immobili, nuovi esperimenti, ribassi e opportunità, ogni mattina" checked={alert} onChange={setAlert} />
            {save.error && <p className="text-[13px] text-bad">{(save.error as Error).message}</p>}
            <div className="flex justify-end gap-8 pt-2">
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
