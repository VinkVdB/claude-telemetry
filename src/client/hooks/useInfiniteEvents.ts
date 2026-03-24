// src/client/hooks/useInfiniteEvents.ts
import { useState, useCallback, useRef } from "react";
import { api } from "../lib/api";
import type { Event, UIEventFilters, EventQueryFilters } from "../lib/types";

export type { UIEventFilters };

export interface UseInfiniteEventsOptions {
  /** Filters for the API call */
  filters: UIEventFilters;
  /** Page size */
  pageSize?: number;
  /** Maximum events held in memory (oldest trimmed when exceeded) */
  maxLoadedEvents?: number;
}

export interface UseInfiniteEventsResult {
  events: Event[];
  total: number;
  isLoading: boolean;
  loadMore: () => void;
  loadPrevious: () => void;
  jumpTo: (seq: number) => void;
  scrollToTop: () => void;
  /** Request a reload; coalesces concurrent SSE signals and respects a 500ms post-fetch cooldown */
  requestReload: () => void;
  /** Reads baseOffset directly from a ref (no stale-closure risk) — use in SSE handlers */
  isAtTop: () => boolean;
  offset: number;
  hasMore: boolean;
  hasPrevious: boolean;
  jumpTargetEventId: string | null;
}

/** Convert UI filters (with null agentIds) to wire format (string-only agentIds) */
function toWireFilters(filters: UIEventFilters): EventQueryFilters {
  const wire: EventQueryFilters = { ...filters };
  if (filters.agentIds) {
    wire.agentIds = filters.agentIds.map(id => (id === null ? "__main__" : id));
  }
  return wire;
}

export function useInfiniteEvents(
  options: UseInfiniteEventsOptions
): UseInfiniteEventsResult {
  const { filters, pageSize = 200, maxLoadedEvents = 2000 } = options;

  const [events, setEvents] = useState<Event[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [jumpTargetEventId, setJumpTargetEventId] = useState<string | null>(null);

  const baseOffsetRef = useRef(0);
  const totalRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const filtersKeyRef = useRef("");

  // SSE reload debounce state
  const loadingRef = useRef(false);
  const shouldReloadAfterFetchRef = useRef(false);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep a stable ref to fetchPage for use inside timers
  const fetchPageRef = useRef<(pageOffset: number, mode: "replace" | "append" | "prepend") => Promise<void>>(
    async () => {}
  );

  const fetchPage = useCallback(
    async (
      pageOffset: number,
      mode: "replace" | "append" | "prepend"
    ): Promise<void> => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoading(true);
      loadingRef.current = true;

      // A new fetch supersedes any pending reload timer — defer the reload until after this fetch
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
        shouldReloadAfterFetchRef.current = true;
      }

      const MAX_EMPTY_RETRIES = 10;
      let currentOffset = pageOffset;
      let didSetEvents = false;

      try {
        for (let attempt = 0; attempt <= MAX_EMPTY_RETRIES; attempt++) {
          const wireFilters = toWireFilters({ ...filters, limit: pageSize, offset: currentOffset });

          const result = await api.events.query(wireFilters);

          if (controller.signal.aborted) return;

          setTotal(result.total);
          totalRef.current = result.total;

          if (result.events.length === 0) {
            const nextOffset = currentOffset + pageSize;
            if (nextOffset < result.total && attempt < MAX_EMPTY_RETRIES) {
              currentOffset = nextOffset;
              continue;
            }
            break;
          }

          if (mode === "replace") {
            setEvents(result.events);
            didSetEvents = true;
            baseOffsetRef.current = currentOffset;
            setOffset(currentOffset);
          } else if (mode === "append") {
            setEvents((prev) => {
              const combined = [...prev, ...result.events];
              if (combined.length > maxLoadedEvents) {
                const trimCount = combined.length - maxLoadedEvents;
                baseOffsetRef.current += trimCount;
                return combined.slice(trimCount);
              }
              return combined;
            });
          } else if (mode === "prepend") {
            setEvents((prev) => {
              const combined = [...result.events, ...prev];
              if (combined.length > maxLoadedEvents) return combined.slice(0, maxLoadedEvents);
              return combined;
            });
            baseOffsetRef.current = currentOffset;
          }

          break;
        }
        // Replace mode with no results — clear stale events so the list doesn't show the previous selection
        if (mode === "replace" && !didSetEvents && !controller.signal.aborted) {
          setEvents([]);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (controller.signal.aborted) return;
        console.error("Failed to fetch events:", err);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
          loadingRef.current = false;

          // If a reload was deferred while this fetch was in progress, schedule it after 500ms
          if (shouldReloadAfterFetchRef.current) {
            shouldReloadAfterFetchRef.current = false;
            reloadTimerRef.current = setTimeout(() => {
              reloadTimerRef.current = null;
              if (!loadingRef.current) {
                baseOffsetRef.current = 0;
                setOffset(0);
                fetchPageRef.current(0, "replace");
              }
            }, 500);
          }
        }
      }
    },
    [filters, pageSize, maxLoadedEvents]
  );

  // Keep fetchPageRef current so timers always call the latest version
  fetchPageRef.current = fetchPage;

  // Initial load + reload when filters change
  // NOTE: We do NOT call setEvents([]) here — keeping old events visible while
  // the new page loads prevents the table from collapsing and causing a page-level scroll.
  const filtersKey = JSON.stringify(filters);
  if (filtersKey !== filtersKeyRef.current) {
    filtersKeyRef.current = filtersKey;
    baseOffsetRef.current = 0;
    setOffset(0);
    setJumpTargetEventId(null);
    fetchPage(0, "replace");
  }

  const loadMore = useCallback(() => {
    if (isLoading) return;
    const nextOffset = baseOffsetRef.current + events.length;
    if (nextOffset >= total) return;
    setJumpTargetEventId(null);
    setOffset(nextOffset);
    fetchPage(nextOffset, "append");
  }, [isLoading, events.length, total, fetchPage]);

  const loadPrevious = useCallback(() => {
    if (isLoading) return;
    if (baseOffsetRef.current <= 0) return;
    const prevOffset = Math.max(0, baseOffsetRef.current - pageSize);
    setJumpTargetEventId(null);
    fetchPage(prevOffset, "prepend");
  }, [isLoading, pageSize, fetchPage]);

  /**
   * Jump to event number `pos` (1-based, oldest=1, newest=total).
   * Computes the DESC offset directly — no extra API round-trip needed.
   */
  const jumpTo = useCallback(
    (pos: number) => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoading(true);
      loadingRef.current = true;

      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
        shouldReloadAfterFetchRef.current = true;
      }

      // Events ordered DESC: position 1 (oldest) is at DESC offset (total-1),
      // position total (newest) is at DESC offset 0.
      const currentTotal = totalRef.current;
      const targetOffset = Math.max(0, Math.min(currentTotal - pos, currentTotal - 1));
      const windowStart = Math.max(0, targetOffset - Math.floor(pageSize / 2));

      baseOffsetRef.current = windowStart;
      setOffset(windowStart);

      api.events
        .query(toWireFilters({ ...filters, limit: pageSize, offset: windowStart }))
        .then((result) => {
          if (controller.signal.aborted) return;
          setTotal(result.total);
          totalRef.current = result.total;
          setEvents(result.events);
          // Target event is at index (targetOffset - windowStart) in the DESC result
          const targetEvent = result.events[targetOffset - windowStart];
          setJumpTargetEventId(targetEvent?.id ?? null);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          console.error("Failed to jump to event:", err);
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsLoading(false);
            loadingRef.current = false;

            if (shouldReloadAfterFetchRef.current) {
              shouldReloadAfterFetchRef.current = false;
              reloadTimerRef.current = setTimeout(() => {
                reloadTimerRef.current = null;
                if (!loadingRef.current) {
                  baseOffsetRef.current = 0;
                  setOffset(0);
                  fetchPageRef.current(0, "replace");
                }
              }, 500);
            }
          }
        });
    },
    [filters, pageSize]
  );

  const scrollToTop = useCallback(() => {
    baseOffsetRef.current = 0;
    setOffset(0);
    setJumpTargetEventId(null);
    // Don't clear events here — prevents the table from collapsing and causing page-level scroll
    fetchPage(0, "replace");
  }, [fetchPage]);

  /**
   * Request a reload of the top page, coalescing multiple concurrent SSE signals.
   * - While a fetch is in progress: queues a single reload for after it completes (+500ms)
   * - Otherwise: schedules a reload in 500ms (debounced — multiple calls collapse into one)
   */
  const requestReload = useCallback(() => {
    if (loadingRef.current) {
      shouldReloadAfterFetchRef.current = true;
      return;
    }
    // Debounce: cancel any existing timer and reschedule
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      if (!loadingRef.current) {
        baseOffsetRef.current = 0;
        setOffset(0);
        fetchPageRef.current(0, "replace");
      }
    }, 500);
  }, []);

  const hasMore     = baseOffsetRef.current + events.length < total;
  const hasPrevious = baseOffsetRef.current > 0;
  // Reads the ref directly — safe to call inside SSE callbacks without stale-closure risk
  const isAtTop = useCallback(() => baseOffsetRef.current === 0, []);

  return {
    events,
    total,
    isLoading,
    loadMore,
    loadPrevious,
    jumpTo,
    scrollToTop,
    requestReload,
    isAtTop,
    offset: baseOffsetRef.current,
    hasMore,
    hasPrevious,
    jumpTargetEventId,
  };
}
