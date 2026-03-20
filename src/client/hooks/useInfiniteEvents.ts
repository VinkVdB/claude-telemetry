import { useState, useCallback, useRef } from "react";
import { api } from "../lib/api";
import type { Event } from "../lib/types";

export interface UseInfiniteEventsOptions {
  /** Base filters for the API call (e.g., sessionId, type, model) */
  filters: Record<string, string>;
  /** Page size */
  pageSize?: number;
  /** Maximum events held in memory (oldest trimmed when exceeded) */
  maxLoadedEvents?: number;
}

export interface UseInfiniteEventsResult {
  events: Event[];
  total: number;
  isLoading: boolean;
  /** Call when scroll reaches bottom */
  loadMore: () => void;
  /** Call when scroll reaches top */
  loadPrevious: () => void;
  /** Jump to a specific event number (1-based, highest = most recent) — centers it in the loaded window */
  jumpTo: (eventNumber: number) => void;
  /** Scroll back to top and reload from offset 0 */
  scrollToTop: () => void;
  /** Current starting offset (0 = most recent) */
  offset: number;
  /** Whether more events exist below current loaded set */
  hasMore: boolean;
  /** Whether earlier (more recent) events exist above current loaded set */
  hasPrevious: boolean;
  /** Event ID of the last jump target, or null */
  jumpTargetEventId: string | null;
}

export function useInfiniteEvents(
  options: UseInfiniteEventsOptions
): UseInfiniteEventsResult {
  const { filters, pageSize = 100, maxLoadedEvents = 500 } = options;

  const [events, setEvents] = useState<Event[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [jumpTargetEventId, setJumpTargetEventId] = useState<string | null>(null);

  // Track the "base" offset — the offset of the first loaded event
  const baseOffsetRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // Serialize filters for dependency tracking
  const filtersKeyRef = useRef("");

  const fetchPage = useCallback(
    async (
      pageOffset: number,
      mode: "replace" | "append" | "prepend"
    ): Promise<void> => {
      // Abort any in-flight request
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoading(true);

      try {
        const params: Record<string, string> = {
          ...filters,
          limit: String(pageSize),
          offset: String(pageOffset),
        };

        const result = await api.events.list(params);

        // If this request was aborted, bail out
        if (controller.signal.aborted) return;

        setTotal(result.total);

        if (mode === "replace") {
          setEvents(result.events);
          baseOffsetRef.current = pageOffset;
          setOffset(pageOffset);
        } else if (mode === "append") {
          setEvents((prev) => {
            const combined = [...prev, ...result.events];
            // Trim from the front if we exceed max loaded
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
            // Trim from the back if we exceed max loaded
            if (combined.length > maxLoadedEvents) {
              return combined.slice(0, maxLoadedEvents);
            }
            return combined;
          });
          baseOffsetRef.current = pageOffset;
        }
      } catch (err) {
        // Ignore abort errors
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (controller.signal.aborted) return;
        console.error("Failed to fetch events:", err);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    [filters, pageSize]
  );

  // Initial load + reload when filters change
  const filtersKey = JSON.stringify(filters);
  if (filtersKey !== filtersKeyRef.current) {
    filtersKeyRef.current = filtersKey;
    // Reset state and fetch first page
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
      // eventNumber is 1-based where total = most recent
      // Convert to offset: event #N is at offset (total - N)
      const targetOffset = Math.max(0, Math.min(total - eventNumber, total - 1));
      // Load a window centered around the target: 1 page before + target page
      const windowStart = Math.max(0, targetOffset - pageSize);

      baseOffsetRef.current = windowStart;
      setOffset(windowStart);
      setEvents([]);
      setJumpTargetEventId(null); // will be set after fetch

      // Fetch the larger window
      const windowSize = Math.min(pageSize * 2, total - windowStart);
      const controller = new AbortController();
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = controller;
      setIsLoading(true);

      api.events
        .list({
          ...filters,
          limit: String(windowSize),
          offset: String(windowStart),
        })
        .then((result) => {
          if (controller.signal.aborted) return;
          setTotal(result.total);
          setEvents(result.events);
          baseOffsetRef.current = windowStart;
          // Find the event at the target offset and store its ID
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

  const hasMore = baseOffsetRef.current + events.length < total;
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
