// src/client/components/RawExplorer.tsx
import { useState, useMemo } from "react";
import { useInfiniteEvents } from "../hooks/useInfiniteEvents";
import { useSSE } from "../lib/sse";
import { EventTable } from "./EventTable";
import { DetailPanel } from "./DetailPanel";
import type { Event } from "../lib/types";

export function RawExplorer() {
  const [selected, setSelected] = useState<Event | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({
    type: "",
    model: "",
  });
  const [search, setSearch] = useState("");

  // Build API filters (only include non-empty values)
  const apiFilters = useMemo(() => {
    const result: Record<string, string> = {};
    Object.entries(filters).forEach(([k, v]) => {
      if (v) result[k] = v;
    });
    return result;
  }, [filters]);

  const {
    events,
    total,
    isLoading,
    loadMore,
    loadPrevious,
    jumpTo,
    scrollToTop,
    offset,
    hasMore,
    hasPrevious,
    jumpTargetEventId,
  } = useInfiniteEvents({ filters: apiFilters, pageSize: 100 });

  // Stable event number map from unfiltered data
  const eventNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    events.forEach((e, i) => {
      map.set(e.id, total - offset - i);
    });
    return map;
  }, [events, total, offset]);

  // Client-side search filter on loaded events
  const filteredEvents = useMemo(
    () =>
      search
        ? events.filter((e) =>
            e.raw?.toLowerCase().includes(search.toLowerCase())
          )
        : events,
    [events, search]
  );

  // SSE: scroll to top on new events
  useSSE((_eventName) => {
    scrollToTop();
  });

  return (
    <div className="flex gap-4 items-start">
      {/* Left: filters + EventTable */}
      <div className="flex-[3] min-w-0">
        {/* Filters */}
        <div className="flex gap-3 mb-4 flex-wrap">
          <select
            value={filters.type}
            onChange={(e) =>
              setFilters((f) => ({ ...f, type: e.target.value }))
            }
            className="border border-border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All types</option>
            <option value="assistant">Assistant</option>
            <option value="user">User</option>
            <option value="progress">Progress</option>
            <option value="system">System</option>
          </select>
          <select
            value={filters.model}
            onChange={(e) =>
              setFilters((f) => ({ ...f, model: e.target.value }))
            }
            className="border border-border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All models</option>
            <option value="claude-opus-4-6">Opus</option>
            <option value="claude-sonnet-4-6">Sonnet</option>
            <option value="claude-haiku-4-5">Haiku</option>
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search raw JSON..."
            className="border border-border rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[160px]"
          />
        </div>

        <EventTable
          events={filteredEvents}
          total={total}
          isLoading={isLoading}
          onLoadMore={loadMore}
          onLoadPrevious={loadPrevious}
          offset={offset}
          hasMore={hasMore}
          hasPrevious={hasPrevious}
          onJumpTo={jumpTo}
          onScrollToTop={scrollToTop}
          selected={selected}
          onSelect={setSelected}
          eventNumberMap={eventNumberMap}
          jumpTargetEventId={jumpTargetEventId}
        />
      </div>

      {/* Right: detail panel */}
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
