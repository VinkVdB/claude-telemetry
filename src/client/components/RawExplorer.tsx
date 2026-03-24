// src/client/components/RawExplorer.tsx
import { useState, useMemo } from "react";
import { useInfiniteEvents } from "../hooks/useInfiniteEvents";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useSSE } from "../lib/sse";
import { EventTable } from "./EventTable";
import { DetailPanel } from "./DetailPanel";
import type { Event } from "../lib/types";

export function RawExplorer() {
  const [selected, setSelected] = useState<Event | null>(null);
  const [typeFilter, setTypeFilter]   = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [newEventCount, setNewEventCount] = useState(0);

  // Debounce search — 300ms so we don't fire a request per keystroke
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  const filters = useMemo(() => ({
    ...(typeFilter  ? { type:   typeFilter  } : {}),
    ...(modelFilter ? { model:  modelFilter } : {}),
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
  }), [typeFilter, modelFilter, debouncedSearch]);

  const {
    events,
    total,
    isLoading,
    loadMore,
    loadPrevious,
    jumpTo,
    scrollToTop,
    requestReload,
    isAtTop,
    offset,
    hasMore,
    hasPrevious,
    jumpTargetEventId,
  } = useInfiniteEvents({ filters, pageSize: 100 });

  const eventNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    // Compute 1-based chronological position: oldest=1, newest=total.
    // Events are ordered DESC (newest first at offset 0), so position = total - offset - i.
    events.forEach((e, i) => map.set(e.id, total - offset - i));
    return map;
  }, [events, total, offset]);

  // SSE: reload with debounce if at top; show banner if user has scrolled back
  // Use isAtTop() to avoid stale-closure offset reads
  useSSE((_eventName) => {
    if (isAtTop()) {
      requestReload();
    } else {
      setNewEventCount((c) => c + 1);
    }
  });

  const handleScrollToTop = () => {
    scrollToTop();
    setNewEventCount(0);
  };

  return (
    <div className="flex gap-4 items-start">
      <div className="flex-[3] min-w-0">
        {/* Filters */}
        <div className="flex gap-3 mb-4 flex-wrap">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="border border-border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All types</option>
            <option value="assistant">Assistant</option>
            <option value="user">User</option>
            <option value="progress">Progress</option>
            <option value="system">System</option>
          </select>
          <select
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            className="border border-border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All models</option>
            <option value="claude-opus-4-6">Opus</option>
            <option value="claude-sonnet-4-6">Sonnet</option>
            <option value="claude-haiku-4-5">Haiku</option>
          </select>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search raw JSON..."
            className="border border-border rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[160px]"
          />
        </div>

        {/* New events banner */}
        {newEventCount > 0 && (
          <button
            onClick={handleScrollToTop}
            className="w-full mb-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
          >
            {newEventCount} new event{newEventCount !== 1 ? "s" : ""} — scroll to top
          </button>
        )}

        <EventTable
          events={events}
          total={total}
          isLoading={isLoading}
          onLoadMore={loadMore}
          onLoadPrevious={loadPrevious}
          offset={offset}
          hasMore={hasMore}
          hasPrevious={hasPrevious}
          onJumpTo={jumpTo}
          onScrollToTop={handleScrollToTop}
          selected={selected}
          onSelect={setSelected}
          eventNumberMap={eventNumberMap}
          jumpTargetEventId={jumpTargetEventId}
        />
      </div>

      <div className="flex-[2] min-w-0 sticky top-4">
        {selected ? (
          <DetailPanel event={selected} onClose={() => setSelected(null)} />
        ) : (
          <div className="border border-border rounded-xl p-6 text-center text-muted text-sm">
            Click a row to inspect the event
          </div>
        )}
      </div>
    </div>
  );
}
