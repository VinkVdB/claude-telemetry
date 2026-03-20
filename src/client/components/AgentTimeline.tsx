import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { Event, Agent } from "../lib/types";
import { DetailPanel } from "./DetailPanel";
import { EventTable } from "./EventTable";
import { useInfiniteEvents } from "../hooks/useInfiniteEvents";
import { formatTokens, timeAgo, cn } from "../lib/utils";
import { useSettings } from "../contexts/SettingsContext";

interface AgentSummary {
  id: string | null;
  name: string;
  description: string | null;
  color: string;
  eventCount: number;
  totalTokens: number;
  lastActive: string | null;
  model: string | null;
}

export function AgentTimeline({
  agents,
  events,
  sessionId,
  refreshSignal,
}: {
  agents: Agent[];
  events: Event[];
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
  const [visibleAgents, setVisibleAgents] = useState<Set<string | null>>(() => {
    const set = new Set<string | null>([null]);
    agents.forEach((a) => set.add(a.id));
    return set;
  });

  // Paginated event loading from API
  const hookFilters = useMemo(() => ({ sessionId }), [sessionId]);
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
  } = useInfiniteEvents({ filters: hookFilters, maxLoadedEvents: settings["display.maxLoadedEvents"] ?? 500 });

  // Refresh infinite scroll when SSE signals new data
  const prevRefreshSignal = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal !== undefined && refreshSignal !== prevRefreshSignal.current) {
      prevRefreshSignal.current = refreshSignal;
      scrollToTop();
    }
  }, [refreshSignal, scrollToTop]);

  // Build agent summaries (main + each subagent)
  const summaries = useMemo<AgentSummary[]>(() => {
    const mainEvents = events.filter((e) => !e.agent_id);
    const mainTokens = mainEvents.reduce(
      (sum, e) => sum + (e.input_tokens ?? 0) + (e.output_tokens ?? 0),
      0
    );
    const mainLastEvent =
      mainEvents.length > 0
        ? mainEvents.reduce((latest, e) => (e.timestamp > latest.timestamp ? e : latest)).timestamp
        : null;

    const mainModel = mainEvents.find((e) => e.model)?.model ?? null;

    const main: AgentSummary = {
      id: null,
      name: "main",
      description: null,
      color: MAIN_COLOR,
      eventCount: mainEvents.length,
      totalTokens: mainTokens,
      lastActive: mainLastEvent,
      model: mainModel,
    };

    const agentSummaries: AgentSummary[] = agents.map((agent, i) => {
      const agentEvents = events.filter((e) => e.agent_id === agent.id);
      const lastEvent =
        agentEvents.length > 0
          ? agentEvents.reduce((latest, e) => (e.timestamp > latest.timestamp ? e : latest))
              .timestamp
          : agent.ended_at ?? agent.started_at ?? null;

      const agentModel = agentEvents.find((e) => e.model)?.model ?? null;

      return {
        id: agent.id,
        name: agent.agent_type ?? "agent",
        description: agent.description ?? null,
        color: AGENT_COLORS[i % AGENT_COLORS.length],
        eventCount: agentEvents.length,
        totalTokens: agent.total_tokens,
        lastActive: lastEvent,
        model: agentModel,
      };
    });

    return [main, ...agentSummaries];
  }, [agents, events]);

  // Color lookup map
  const colorMap = useMemo(() => {
    const map = new Map<string | null, string>();
    summaries.forEach((s) => map.set(s.id, s.color));
    return map;
  }, [summaries]);

  // Name lookup map
  const nameMap = useMemo(() => {
    const map = new Map<string | null, string>();
    summaries.forEach((s) => map.set(s.id, s.name));
    return map;
  }, [summaries]);

  // Stable event number map from unfiltered data (event.id → server-side position number)
  const eventNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    hookEvents.forEach((e, i) => {
      map.set(e.id, total - offset - i);
    });
    return map;
  }, [hookEvents, total, offset]);

  // Auto-enable the agent of the jump target event
  useEffect(() => {
    if (!jumpTargetEventId) return;
    const targetEvent = hookEvents.find((e) => e.id === jumpTargetEventId);
    if (targetEvent) {
      const agentId = targetEvent.agent_id ?? null;
      setVisibleAgents((prev) => {
        if (prev.has(agentId)) return prev;
        const next = new Set(prev);
        next.add(agentId);
        return next;
      });
    }
  }, [jumpTargetEventId, hookEvents]);

  // Filter hook events by visible agents
  const filteredEvents = useMemo(
    () => hookEvents.filter((e) => visibleAgents.has(e.agent_id ?? null)),
    [hookEvents, visibleAgents]
  );

  const toggleAgent = useCallback((id: string | null) => {
    setVisibleAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Auto-enable an agent when jumping to one of its events
  const autoEnableAgent = useCallback((agentId: string | null) => {
    setVisibleAgents((prev) => {
      if (prev.has(agentId)) return prev;
      const next = new Set(prev);
      next.add(agentId);
      return next;
    });
  }, []);

  return (
    <div className="space-y-4">
      {/* Agent cards (toggleable filters) */}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(220px, 1fr))` }}
      >
        {summaries.map((s) => {
          const active = visibleAgents.has(s.id);
          return (
            <div
              key={s.id ?? "__main__"}
              onClick={() => toggleAgent(s.id)}
              className={cn(
                "border rounded-xl bg-white p-3 flex flex-col gap-1 cursor-pointer transition-all select-none",
                active
                  ? "border-primary/40 shadow-sm"
                  : "border-border opacity-50",
                "hover:shadow-md"
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                <span className="text-sm font-semibold text-primary-dark truncate">{s.name}</span>
                {s.model && (
                  <span className="text-xs text-muted font-mono ml-auto">{s.model}</span>
                )}
              </div>
              {s.description && (
                <p className="text-xs text-muted truncate" title={s.description}>
                  {s.description}
                </p>
              )}
              <div className="flex items-center gap-3 text-xs text-muted mt-1">
                <span>{s.eventCount} events</span>
                <span>{formatTokens(s.totalTokens, formatOpts)} tok</span>
                {s.lastActive && <span className="ml-auto">{timeAgo(s.lastActive, formatOpts)}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Main area: EventTable + DetailPanel */}
      <div className="flex gap-4 items-start">
        <div className="flex-[3] min-w-0">
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
            showAgentColumn
            colorMap={colorMap}
            nameMap={nameMap}
            onAutoEnableAgent={autoEnableAgent}
          />
        </div>

        {/* Right: detail panel (sticky) */}
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
