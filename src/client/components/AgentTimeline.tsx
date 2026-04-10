// src/client/components/AgentTimeline.tsx
import { useState, useMemo, useCallback, useEffect } from "react";
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
}: {
  agentSummaries: AgentSummary[];
  sessionId: string;
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
  const [searchInput, setSearchInput] = useState("");

  // Chain key: stable id for a logical agent across all its turn transcripts.
  // For the main agent (id=null) the key is null.
  // For subagents with a chain_id the key is chain_id; otherwise it's the individual agent id.
  const getChainKey = (s: AgentSummary): string | null =>
    s.id === null ? null : (s.chain_id ?? s.id);

  // Initialize visibleAgents with chain keys (one per logical agent)
  const [visibleAgents, setVisibleAgents] = useState<Set<string | null>>(
    () => new Set(agentSummaries.map(getChainKey))
  );

  // Sync visibleAgents when new logical agents appear
  useEffect(() => {
    setVisibleAgents(prev => {
      const next = new Set(prev);
      agentSummaries.forEach(s => next.add(getChainKey(s)));
      return next;
    });
  }, [agentSummaries]);

  // Group agentSummaries by chain key, merge stats, assign colors
  const summaries = useMemo(() => {
    const groups = new Map<string | null, AgentSummary[]>();
    for (const s of agentSummaries) {
      const key = getChainKey(s);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }

    let subagentIndex = 0;
    return [...groups.entries()].map(([chainKey, members]) => {
      const isMain = chainKey === null;
      const first = members[0];

      const eventCount = members.reduce((sum, m) => sum + m.event_count, 0);
      const totalTokens = members.reduce((sum, m) => sum + m.total_tokens, 0);
      const lastActive = members.reduce((latest, m) => {
        if (!latest) return m.last_active;
        if (!m.last_active) return latest;
        return m.last_active > latest ? m.last_active : latest;
      }, null as string | null);
      const lastModel = members
        .filter(m => m.last_active && m.last_model)
        .sort((a, b) => (b.last_active ?? "") > (a.last_active ?? "") ? 1 : -1)[0]?.last_model ?? first.last_model;

      const colorIndex = isMain ? -1 : subagentIndex++;
      return {
        ...first,
        chainKey,
        event_count: eventCount,
        total_tokens: totalTokens,
        last_active: lastActive,
        last_model: lastModel,
        turn_count: members.length > 1 ? members.length : null,
        color: isMain ? MAIN_COLOR : AGENT_COLORS[colorIndex % AGENT_COLORS.length],
        name: isMain ? "main" : (first.agent_type ?? "agent"),
      };
    });
  }, [agentSummaries, MAIN_COLOR, AGENT_COLORS]);

  // Map individual agent_id -> color/name (for EventTable row coloring)
  const colorMap = useMemo(() => {
    const chainToColor = new Map<string | null, string>(summaries.map(s => [s.chainKey, s.color]));
    const map = new Map<string | null, string>();
    agentSummaries.forEach(s => map.set(s.id, chainToColor.get(getChainKey(s)) ?? MAIN_COLOR));
    return map;
  }, [summaries, agentSummaries, MAIN_COLOR]);

  const nameMap = useMemo(() => {
    const chainToName = new Map<string | null, string>(summaries.map(s => [s.chainKey, s.name]));
    const map = new Map<string | null, string>();
    agentSummaries.forEach(s => map.set(s.id, chainToName.get(getChainKey(s)) ?? "agent"));
    return map;
  }, [summaries, agentSummaries]);

  // Debounce visible agents -> agentIds filter (150ms to batch rapid show/hide-all clicks)
  const debouncedVisibleAgents = useDebouncedValue(visibleAgents, 150);
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  const hookFilters = useMemo(() => {
    const allChainKeys = new Set(agentSummaries.map(getChainKey));
    const allVisible = [...allChainKeys].every(key => debouncedVisibleAgents.has(key));
    const searchOpt = debouncedSearch ? { search: debouncedSearch } : {};

    if (allVisible) {
      // No agentIds filter - return all events for this session
      return { sessionId, ...searchOpt };
    }

    return {
      sessionId,
      agentIds: [...debouncedVisibleAgents] as (string | null)[],
      ...searchOpt,
    };
  }, [sessionId, debouncedVisibleAgents, agentSummaries, debouncedSearch]);

  const {
    events: hookEvents,
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
  } = useInfiniteEvents({
    filters: hookFilters,
    maxLoadedEvents: settings["display.maxLoadedEvents"] ?? 500,
  });

  // SSE: new event for this session — use isAtTop() to avoid stale-closure offset reads
  useSSE((_event, data) => {
    if (data?.sessionId === sessionId) {
      if (isAtTop()) {
        requestReload();
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
    // Compute 1-based chronological position: oldest=1, newest=total.
    // Events are ordered DESC (newest first at offset 0), so position = total - offset - i.
    hookEvents.forEach((e, i) => map.set(e.id, total - offset - i));
    return map;
  }, [hookEvents, total, offset]);

  // Auto-enable agent when jumping to one of its events
  useEffect(() => {
    if (!jumpTargetEventId) return;
    const targetEvent = hookEvents.find(e => e.id === jumpTargetEventId);
    if (targetEvent) {
      const agentId = targetEvent.agent_id ?? null;
      const summary = agentSummaries.find(s => s.id === agentId);
      const chainKey = agentId === null ? null : (summary?.chain_id ?? agentId);
      setVisibleAgents(prev => {
        if (prev.has(chainKey)) return prev;
        const next = new Set(prev);
        next.add(chainKey);
        return next;
      });
    }
  }, [jumpTargetEventId, hookEvents, agentSummaries]);

  const toggleAgent = useCallback((chainKey: string | null) => {
    setVisibleAgents(prev => {
      const next = new Set(prev);
      if (next.has(chainKey)) next.delete(chainKey);
      else next.add(chainKey);
      return next;
    });
  }, []);

  const hideAll = useCallback(() => setVisibleAgents(new Set()), []);
  const showAll = useCallback(() => {
    setVisibleAgents(new Set(agentSummaries.map(getChainKey)));
  }, [agentSummaries]);

  const autoEnableAgent = useCallback((agentId: string | null) => {
    const summary = agentSummaries.find(s => s.id === agentId);
    const chainKey = agentId === null ? null : (summary?.chain_id ?? agentId);
    setVisibleAgents(prev => {
      if (prev.has(chainKey)) return prev;
      const next = new Set(prev);
      next.add(chainKey);
      return next;
    });
  }, [agentSummaries]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-semibold text-primary-dark">Agents</span>
        <div className="flex gap-1.5">
          <button onClick={hideAll} className="text-xs text-muted hover:text-primary-dark border border-border rounded px-2 py-0.5 hover:border-primary transition-colors">Hide all</button>
          <button onClick={showAll} className="text-xs text-muted hover:text-primary-dark border border-border rounded px-2 py-0.5 hover:border-primary transition-colors">Show all</button>
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
        {summaries.map((s) => {
          const active = visibleAgents.has(s.chainKey);
          return (
            <div
              key={s.chainKey ?? "__main__"}
              onClick={() => toggleAgent(s.chainKey)}
              className={cn(
                "border rounded-xl bg-bg p-3 flex flex-col gap-1 cursor-pointer transition-all select-none",
                active ? "border-primary/40 shadow-sm" : "border-border opacity-50",
                "hover:shadow-md"
              )}
            >
              <div className="group/header flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-sm font-semibold text-primary-dark truncate group-hover/header:overflow-visible group-hover/header:whitespace-normal">{s.name}</span>
                {s.turn_count != null && s.turn_count > 1 && (
                  <span className="text-xs font-medium text-muted bg-surface border border-border rounded px-1.5 py-0.5 shrink-0 group-hover/header:hidden">
                    {s.turn_count} turns
                  </span>
                )}
                {s.last_model && (
                  <span className="text-xs text-muted font-mono ml-auto shrink-0 group-hover/header:hidden">{s.last_model.replace("claude-", "")}</span>
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
          <div className="mb-3">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Filter events by tool, content, agent..."
              className="w-full border border-border rounded-lg px-3 py-1.5 text-sm bg-surface"
            />
          </div>
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
