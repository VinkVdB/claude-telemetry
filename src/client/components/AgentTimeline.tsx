// src/client/components/AgentTimeline.tsx
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { Event, AgentSummary } from "../lib/types";
import { DetailPanel } from "./DetailPanel";
import { EventTable } from "./EventTable";
import { useInfiniteEvents } from "../hooks/useInfiniteEvents";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useSSE } from "../lib/sse";
import { formatTokens, timeAgo, cn } from "../lib/utils";
import { useSettings } from "../contexts/SettingsContext";

export function AgentTimeline({
  agentSummaries,
  sessionId,
  refreshSignal,
}: {
  agentSummaries: AgentSummary[];
  sessionId: string;
  refreshSignal?: number;
}) {
  const { settings } = useSettings();
  const AGENT_COLORS: string[] = settings["graph.agentColors"] ?? ["#00a2e0", "#bdd72d", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];
  const MAIN_COLOR: string = settings["graph.mainColor"] ?? "#003864";
  const formatOpts = {
    kThreshold: settings["display.tokenKThreshold"] as number,
    mThreshold: settings["display.tokenMThreshold"] as number,
    costPrecisionThreshold: settings["display.costPrecisionThreshold"] as number,
    timeAgoJustNow: settings["display.timeAgoJustNow"] as number,
    timeAgoMinutes: settings["display.timeAgoMinutes"] as number,
    timeAgoHours: settings["display.timeAgoHours"] as number,
  };

  const [selected, setSelected] = useState<Event | null>(null);
  const [newEventCount, setNewEventCount] = useState(0);

  // Initialize all agents as visible
  const [visibleAgents, setVisibleAgents] = useState<Set<string | null>>(
    () => new Set(agentSummaries.map(s => s.id))
  );

  // Sync visibleAgents set when agentSummaries changes (e.g. new agent appears)
  useEffect(() => {
    setVisibleAgents(prev => {
      const next = new Set(prev);
      agentSummaries.forEach(s => next.add(s.id));
      return next;
    });
  }, [agentSummaries]);

  // Color and name maps derived from agentSummaries
  // Main (id=null) always gets MAIN_COLOR; subagents get AGENT_COLORS by index
  const summaries = useMemo(() => {
    return agentSummaries.map((s, i) => ({
      ...s,
      color: s.id === null
        ? MAIN_COLOR
        : AGENT_COLORS[(i - 1) % AGENT_COLORS.length],  // i-1 because main is index 0
      name: s.id === null ? "main" : (s.agent_type ?? "agent"),
    }));
  }, [agentSummaries, MAIN_COLOR, AGENT_COLORS]);

  const colorMap = useMemo(() => {
    const map = new Map<string | null, string>();
    summaries.forEach(s => map.set(s.id, s.color));
    return map;
  }, [summaries]);

  const nameMap = useMemo(() => {
    const map = new Map<string | null, string>();
    summaries.forEach(s => map.set(s.id, s.name));
    return map;
  }, [summaries]);

  // Debounce visible agents -> agentIds filter (150ms to batch rapid show/hide-all clicks)
  const debouncedVisibleAgents = useDebouncedValue(visibleAgents, 150);

  const hookFilters = useMemo(() => {
    const allIds = new Set(agentSummaries.map(s => s.id));
    const allVisible = [...allIds].every(id => debouncedVisibleAgents.has(id));

    if (allVisible) {
      // No agentIds filter -- return all events for this session
      return { sessionId };
    }

    return {
      sessionId,
      agentIds: [...debouncedVisibleAgents] as (string | null)[],
    };
  }, [sessionId, debouncedVisibleAgents, agentSummaries]);

  const {
    events: hookEvents,
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
  } = useInfiniteEvents({
    filters: hookFilters,
    maxLoadedEvents: settings["display.maxLoadedEvents"] ?? 500,
  });

  // Refresh on SSE signal from parent
  const prevRefreshSignal = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal !== undefined && refreshSignal !== prevRefreshSignal.current) {
      prevRefreshSignal.current = refreshSignal;
      if (offset === 0 && !isLoading) {
        scrollToTop();
      } else {
        setNewEventCount(c => c + 1);
      }
    }
  }, [refreshSignal, scrollToTop, offset, isLoading]);

  // SSE: new event for this session
  useSSE((_event, data) => {
    if (data?.sessionId === sessionId) {
      if (offset === 0 && !isLoading) {
        scrollToTop();
      } else {
        setNewEventCount(c => c + 1);
      }
    }
  });

  const handleScrollToTop = () => {
    scrollToTop();
    setNewEventCount(0);
  };

  const eventNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    hookEvents.forEach((e, i) => {
      map.set(e.id, total - offset - i);
    });
    return map;
  }, [hookEvents, total, offset]);

  // Auto-enable agent when jumping to one of its events
  useEffect(() => {
    if (!jumpTargetEventId) return;
    const targetEvent = hookEvents.find(e => e.id === jumpTargetEventId);
    if (targetEvent) {
      const agentId = targetEvent.agent_id ?? null;
      setVisibleAgents(prev => {
        if (prev.has(agentId)) return prev;
        const next = new Set(prev);
        next.add(agentId);
        return next;
      });
    }
  }, [jumpTargetEventId, hookEvents]);

  const toggleAgent = useCallback((id: string | null) => {
    setVisibleAgents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const hideAll = useCallback(() => setVisibleAgents(new Set()), []);
  const showAll = useCallback(() => {
    setVisibleAgents(new Set(agentSummaries.map(s => s.id)));
  }, [agentSummaries]);

  const autoEnableAgent = useCallback((agentId: string | null) => {
    setVisibleAgents(prev => {
      if (prev.has(agentId)) return prev;
      const next = new Set(prev);
      next.add(agentId);
      return next;
    });
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-semibold text-primary-dark">Agents</span>
        <div className="flex gap-1.5">
          <button onClick={hideAll} className="text-xs text-muted hover:text-primary-dark border border-border rounded px-2 py-0.5 hover:border-primary transition-colors">Hide all</button>
          <button onClick={showAll} className="text-xs text-muted hover:text-primary-dark border border-border rounded px-2 py-0.5 hover:border-primary transition-colors">Show all</button>
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(220px, 1fr))` }}>
        {summaries.map((s) => {
          const active = visibleAgents.has(s.id);
          return (
            <div
              key={s.id ?? "__main__"}
              onClick={() => toggleAgent(s.id)}
              className={cn(
                "border rounded-xl bg-white p-3 flex flex-col gap-1 cursor-pointer transition-all select-none",
                active ? "border-primary/40 shadow-sm" : "border-border opacity-50",
                "hover:shadow-md"
              )}
            >
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-sm font-semibold text-primary-dark truncate">{s.name}</span>
                {s.last_model && (
                  <span className="text-xs text-muted font-mono ml-auto">{s.last_model.replace("claude-", "")}</span>
                )}
              </div>
              {s.description && (
                <p className="text-xs text-muted truncate" title={s.description}>{s.description}</p>
              )}
              <div className="flex items-center gap-3 text-xs text-muted mt-1">
                <span>{s.event_count} events</span>
                <span>{formatTokens(s.total_tokens, formatOpts)} tok</span>
                {s.last_active && <span className="ml-auto">{timeAgo(s.last_active, formatOpts)}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* New events banner */}
      {newEventCount > 0 && (
        <button
          onClick={handleScrollToTop}
          className="w-full py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
        >
          {newEventCount} new event{newEventCount !== 1 ? "s" : ""} — scroll to top
        </button>
      )}

      <div className="flex gap-4 items-start">
        <div className="flex-[3] min-w-0">
          <EventTable
            events={hookEvents}
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
            showAgentColumn
            colorMap={colorMap}
            nameMap={nameMap}
            onAutoEnableAgent={autoEnableAgent}
          />
        </div>
        <div className="flex-[2] min-w-0 sticky top-4 self-start">
          {selected ? (
            <DetailPanel event={selected} onClose={() => setSelected(null)} />
          ) : (
            <div className="border border-border rounded-xl bg-surface p-6 text-center text-muted text-sm">
              Click a row to inspect the event
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
