import { useVirtualizer } from "@tanstack/react-virtual";
import { SearchX } from "lucide-react";
import { useEffect, useRef } from "react";
import type { LottoListItem } from "@/lib/types";
import { useNow } from "@/lib/hooks";
import { LottoRow } from "./LottoRow";
import { Empty, Spinner } from "./ui";

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
