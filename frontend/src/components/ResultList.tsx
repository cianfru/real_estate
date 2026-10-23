import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { DatabaseZap, SearchX } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import type { LottoListItem, Meta } from "@/lib/types";
import { useMe, useNow } from "@/lib/hooks";
import { LottoRow } from "./LottoRow";
import { Empty, Spinner } from "./ui";

/** Nothing in the database yet: say why, and refresh by itself while the first load runs. */
function FirstLoad() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const meta = useQuery({
    queryKey: ["meta"],
    queryFn: () => api<Meta>("/meta"),
    refetchInterval: (q) => (q.state.data?.totals.active === 0 ? 15_000 : false),
  });
  const active = meta.data?.totals.active ?? 0;
  useEffect(() => {
    if (active > 0) void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "meta" && q.queryKey[0] !== "me" });
  }, [active, qc]);
  if (meta.data?.sync_running)
    return (
      <Empty icon={<Spinner />} title="Primo caricamento in corso">
        Stiamo leggendo dal Portale delle Vendite Pubbliche le aste di tutta Italia (circa 20 minuti). La mappa si riempie da sola: non serve ricaricare.
      </Empty>
    );
  return (
    <Empty icon={<DatabaseZap className="size-5" />} title="Ancora nessun immobile">
      {me?.is_admin ? (
        <>
          Avvia il primo caricamento dalla pagina{" "}
          <Link to="/admin" className="font-medium text-ink underline-offset-4 hover:underline">
            Admin
          </Link>
          : scegli «Italia» e «Avvia la sincronizzazione».
        </>
      ) : (
        "Il database è vuoto: chiedi all'amministratore di avviare la prima sincronizzazione."
      )}
    </Empty>
  );
}

export function ResultList({
  items,
  total,
  loading,
  hasMore,
  loadMore,
  hoveredId,
  selectedId,
  onHover,
  onSelect,
}: {
  items: LottoListItem[];
  total: number;
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  hoveredId: number | null;
  selectedId: number | null;
  onHover: (id: number | null) => void;
  onSelect: (lot: LottoListItem) => void;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const now = useNow();
  const v = useVirtualizer({
    count: items.length + (hasMore ? 1 : 0),
    getScrollElement: () => parent.current,
    estimateSize: () => 108,
    overscan: 8,
  });
  const vItems = v.getVirtualItems();
  const last = vItems[vItems.length - 1];

  useEffect(() => {
    if (last && last.index >= items.length - 1 && hasMore && !loading) loadMore();
  }, [last, items.length, hasMore, loading, loadMore]);

  // keep the hovered map marker visible in the list
  useEffect(() => {
    if (hoveredId === null) return;
    const i = items.findIndex((x) => x.id === hoveredId);
    if (i >= 0 && !parent.current?.matches(":hover")) v.scrollToIndex(i, { align: "auto" });
  }, [hoveredId, items, v]);

  const meta = useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/meta"), staleTime: 10 * 60_000 });
  if (!loading && items.length === 0 && meta.data?.totals.active === 0) return <FirstLoad />;
  if (!loading && items.length === 0) {
    return (
      <Empty icon={<SearchX className="size-5" />} title="Nessun immobile trovato">
        Prova ad allargare i filtri o a spostare la mappa.
      </Empty>
    );
  }

  return (
    <div ref={parent} className="scroll-thin h-full overflow-y-auto px-2 pb-3" aria-label={`${total} risultati`}>
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {vItems.map((row) => {
          const lot = items[row.index];
          return (
            <div
              key={row.key}
              data-index={row.index}
              ref={v.measureElement}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start}px)` }}
            >
              {lot ? (
                <LottoRow
                  lot={lot}
                  now={now}
                  active={hoveredId === lot.id}
                  selected={selectedId === lot.id}
                  onHover={onHover}
                  onClick={() => onSelect(lot)}
                />
              ) : (
                <div className="grid h-16 place-items-center">
                  <Spinner />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
