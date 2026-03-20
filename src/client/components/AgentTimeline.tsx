import { useState, useMemo } from "react";
import type { Event, Agent } from "../lib/types";
import { DetailPanel } from "./DetailPanel";
import { formatTokens, formatCost, timeAgo, cn } from "../lib/utils";

const AGENT_COLORS = ["#00a2e0", "#bdd72d", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];
const MAIN_COLOR = "#003864";

interface AgentSummary {
  id: string | null;
  name: string;
  description: string | null;
  color: string;
  eventCount: number;
  totalTokens: number;
  lastActive: string | null;
}

export function AgentTimeline({ agents, events }: { agents: Agent[]; events: Event[] }) {
  const [selected, setSelected] = useState<Event | null>(null);
  const [visibleAgents, setVisibleAgents] = useState<Set<string | null>>(() => {
    const set = new Set<string | null>([null]);
    agents.forEach((a) => set.add(a.id));
    return set;
  });

  // Build agent summaries (main + each subagent)
  const summaries = useMemo<AgentSummary[]>(() => {
    const mainEvents = events.filter((e) => !e.agent_id);
    const mainTokens = mainEvents.reduce(
      (sum, e) => sum + (e.input_tokens ?? 0) + (e.output_tokens ?? 0),
      0
    );
    const mainLastEvent = mainEvents.length > 0
      ? mainEvents.reduce((latest, e) => (e.timestamp > latest.timestamp ? e : latest)).timestamp
      : null;

    const main: AgentSummary = {
      id: null,
      name: "main",
      description: null,
      color: MAIN_COLOR,
      eventCount: mainEvents.length,
      totalTokens: mainTokens,
      lastActive: mainLastEvent,
    };

    const agentSummaries: AgentSummary[] = agents.map((agent, i) => {
      const agentEvents = events.filter((e) => e.agent_id === agent.id);
      const lastEvent = agentEvents.length > 0
        ? agentEvents.reduce((latest, e) => (e.timestamp > latest.timestamp ? e : latest)).timestamp
        : agent.ended_at ?? agent.started_at ?? null;

      return {
        id: agent.id,
        name: agent.agent_type ?? "agent",
        description: agent.description ?? null,
        color: AGENT_COLORS[i % AGENT_COLORS.length],
        eventCount: agentEvents.length,
        totalTokens: agent.total_tokens,
        lastActive: lastEvent,
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

  // Filtered and sorted events
  const filteredEvents = useMemo(
    () =>
      events
        .filter((e) => visibleAgents.has(e.agent_id ?? null))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [events, visibleAgents]
  );

  function toggleAgent(id: string | null) {
    setVisibleAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function formatTimestamp(ts: string) {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  return (
    <div className="space-y-4">
      {/* 1. Agent overview panel */}
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(220px, 1fr))` }}>
        {summaries.map((s) => (
          <div
            key={s.id ?? "__main__"}
            className="border border-border rounded-xl bg-white p-3 flex flex-col gap-1"
          >
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-sm font-semibold text-primary-dark truncate">{s.name}</span>
            </div>
            {s.description && (
              <p className="text-xs text-muted truncate" title={s.description}>
                {s.description}
              </p>
            )}
            <div className="flex items-center gap-3 text-xs text-muted mt-1">
              <span>{s.eventCount} events</span>
              <span>{formatTokens(s.totalTokens)} tok</span>
              {s.lastActive && <span className="ml-auto">{timeAgo(s.lastActive)}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* 2. Agent filter chips */}
      <div className="flex flex-wrap gap-2">
        {summaries.map((s) => {
          const active = visibleAgents.has(s.id);
          return (
            <button
              key={s.id ?? "__main__"}
              onClick={() => toggleAgent(s.id)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                active
                  ? "border-primary/40 bg-primary/10 text-primary-dark"
                  : "border-border bg-white text-muted opacity-50"
              )}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: s.color }}
              />
              <span className="truncate max-w-[120px]">{s.name}</span>
            </button>
          );
        })}
      </div>

      {/* 3. Main area: table + detail panel */}
      <div className="flex gap-4 items-start">
        {/* Left: unified event table */}
        <div className="flex-[3] min-w-0">
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-surface text-muted text-left">
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Agent</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium">Tool</th>
                  <th className="px-3 py-2 font-medium text-right">In</th>
                  <th className="px-3 py-2 font-medium text-right">Out</th>
                  <th className="px-3 py-2 font-medium text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((e) => {
                  const agentKey = e.agent_id ?? null;
                  const color = colorMap.get(agentKey) ?? MAIN_COLOR;
                  const name = nameMap.get(agentKey) ?? "main";
                  return (
                    <tr
                      key={e.id}
                      onClick={() => setSelected(e)}
                      className={cn(
                        "border-t border-border hover:bg-primary/5 cursor-pointer transition-colors",
                        selected?.id === e.id ? "bg-primary/10" : ""
                      )}
                    >
                      <td className="px-3 py-2 font-mono text-muted whitespace-nowrap">
                        {formatTimestamp(e.timestamp)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="text-primary-dark">{name}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-medium",
                            e.type === "assistant"
                              ? "bg-primary/10 text-primary"
                              : e.type === "user"
                                ? "bg-accent/20 text-primary-dark"
                                : "bg-surface text-muted"
                          )}
                        >
                          {e.type}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {e.model?.replace("claude-", "") ?? "\u2014"}
                      </td>
                      <td className="px-3 py-2 font-mono text-primary">{e.tool_name ?? "\u2014"}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {e.input_tokens != null ? formatTokens(e.input_tokens) : "\u2014"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {e.output_tokens != null ? formatTokens(e.output_tokens) : "\u2014"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {e.cost_usd != null ? formatCost(e.cost_usd) : "\u2014"}
                      </td>
                    </tr>
                  );
                })}
                {filteredEvents.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-muted">
                      No events to display.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted mt-2">{filteredEvents.length} events</p>
        </div>

        {/* Right: detail panel (sticky, ~40%) */}
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
