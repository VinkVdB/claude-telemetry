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
  jumpTo: (eventNumber: number) => void;
  scrollToTop: () => void;
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
  const abortRef = useRef<AbortController | null>(null);
  const filtersKeyRef = useRef("");

  const fetchPage = useCallback(
    async (
      pageOffset: number,
      mode: "replace" | "append" | "prepend"
    ): Promise<void> => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoading(true);

      const MAX_EMPTY_RETRIES = 10;
      let currentOffset = pageOffset;

      try {
        for (let attempt = 0; attempt <= MAX_EMPTY_RETRIES; attempt++) {
          const wireFilters = toWireFilters({ ...filters, limit: pageSize, offset: currentOffset });

          const result = await api.events.query(wireFilters);

          if (controller.signal.aborted) return;

          setTotal(result.total);

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
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (controller.signal.aborted) return;
        console.error("Failed to fetch events:", err);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    },
    [filters, pageSize]
  );

  // Initial load + reload when filters change
  const filtersKey = JSON.stringify(filters);
  if (filtersKey !== filtersKeyRef.current) {
    filtersKeyRef.current = filtersKey;
    baseOffsetRef.current = 0;
    setOffset(0);
    setEvents([]);
    setJumpTargetEventId(null);
    fetchPage(0, "replace");
  }

  const loadMore = useCallback(() => {
    if (isLoading) return;
    const nextOffset = baseOffsetRef.current + events.length;
    if (nextOffset >= total) return;
    setOffset(nextOffset);
    fetchPage(nextOffset, "append");
  }, [isLoading, events.length, total, fetchPage]);

  const loadPrevious = useCallback(() => {
    if (isLoading) return;
    if (baseOffsetRef.current <= 0) return;
    const prevOffset = Math.max(0, baseOffsetRef.current - pageSize);
    fetchPage(prevOffset, "prepend");
  }, [isLoading, pageSize, fetchPage]);

  const jumpTo = useCallback(
    (eventNumber: number) => {
      const targetOffset = Math.max(0, Math.min(total - eventNumber, total - 1));
      const windowStart  = Math.max(0, targetOffset - pageSize);

      baseOffsetRef.current = windowStart;
      setOffset(windowStart);
      setEvents([]);
      setJumpTargetEventId(null);

      const windowSize = Math.min(pageSize * 2, total - windowStart);
      const controller = new AbortController();
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = controller;
      setIsLoading(true);

      const wireFilters = toWireFilters({ ...filters, limit: windowSize, offset: windowStart });

      api.events
        .query(wireFilters)
        .then((result) => {
          if (controller.signal.aborted) return;
          setTotal(result.total);
          setEvents(result.events);
          baseOffsetRef.current = windowStart;
          const indexInWindow = targetOffset - windowStart;
          const targetEvent = result.events[indexInWindow];
          setJumpTargetEventId(targetEvent?.id ?? null);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          console.error("Failed to fetch events:", err);
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    },
    [total, pageSize, filters]
  );

  const scrollToTop = useCallback(() => {
    baseOffsetRef.current = 0;
    setOffset(0);
    setEvents([]);
    setJumpTargetEventId(null);
    fetchPage(0, "replace");
  }, [fetchPage]);

  const hasMore     = baseOffsetRef.current + events.length < total;
  const hasPrevious = baseOffsetRef.current > 0;

  return {
    events,
    total,
    isLoading,
    loadMore,
    loadPrevious,
    jumpTo,
    scrollToTop,
    offset: baseOffsetRef.current,
    hasMore,
    hasPrevious,
    jumpTargetEventId,
  };
}
