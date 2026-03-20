import { useState } from "react";
import type { Event, Agent } from "../lib/types";
import { DetailPanel } from "./DetailPanel";
import { formatTokens, formatCost, cn } from "../lib/utils";

const AGENT_COLORS = ["#00a2e0", "#bdd72d", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];

export function AgentTimeline({ agents, events }: { agents: Agent[]; events: Event[] }) {
  const [selected, setSelected] = useState<Event | null>(null);

  // Group events: main = no agent_id, per agent = matching agent_id
  const mainEvents = events.filter((e) => !e.agent_id && (e.type === "assistant" || (e.type === "user" && e.tool_name)));

  return (
    <div className="flex gap-4 min-h-0">
      {/* Left: event list */}
      <div className="flex-1 min-w-0 overflow-auto max-h-[calc(100vh-14rem)]">
        {agents.length === 0 ? (
          <div className="space-y-1">
            {mainEvents.map((e) => (
              <EventRow key={e.id} event={e} color="#00a2e0" selected={selected?.id === e.id} onClick={() => setSelected(e)} />
            ))}
            {mainEvents.length === 0 && (
              <p className="text-muted text-sm py-4 text-center">No events to display.</p>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Main session events */}
            {mainEvents.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full bg-[#003864]" />
                  <span className="text-sm font-medium text-primary-dark">main</span>
                  <span className="text-xs text-muted ml-auto">{mainEvents.length} events</span>
                </div>
                <div className="ml-5 border-l-2 border-[#003864] pl-4 space-y-1">
                  {mainEvents.map((e) => (
                    <EventRow key={e.id} event={e} color="#003864" selected={selected?.id === e.id} onClick={() => setSelected(e)} />
                  ))}
                </div>
              </div>
            )}
            {/* Subagent sections */}
            {agents.map((agent, i) => {
              const color = AGENT_COLORS[i % AGENT_COLORS.length];
              const agentEvents = events.filter((e) => e.agent_id === agent.id && (e.type === "assistant" || (e.type === "user" && e.tool_name)));
              return (
                <div key={agent.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                    <span className="text-sm font-medium text-primary-dark">{agent.agent_type ?? "agent"}</span>
                    {agent.description && <span className="text-xs text-muted">— {agent.description}</span>}
                    <span className="text-xs text-muted ml-auto">{agentEvents.length} events · {formatTokens(agent.total_tokens)} tok</span>
                  </div>
                  <div className="ml-5 border-l-2 pl-4 space-y-1" style={{ borderColor: color }}>
                    {agentEvents.map((e) => (
                      <EventRow key={e.id} event={e} color={color} selected={selected?.id === e.id} onClick={() => setSelected(e)} />
                    ))}
                    {agentEvents.length === 0 && (
                      <p className="text-xs text-muted py-2">No events for this agent.</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right: detail panel */}
      <div className="w-96 shrink-0 sticky top-0 self-start">
        {selected ? (
          <DetailPanel event={selected} onClose={() => setSelected(null)} />
        ) : (
          <div className="border border-border rounded-xl bg-surface p-6 text-center text-muted text-sm">
            Select an event to see details
          </div>
        )}
      </div>
    </div>
  );
}

function EventRow({ event, color, selected, onClick }: { event: Event; color: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm",
        selected ? "bg-primary/10 text-primary-dark" : "hover:bg-surface"
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-muted text-xs w-20 shrink-0">
        {new Date(event.timestamp).toLocaleTimeString()}
      </span>
      {event.tool_name && (
        <span className="bg-primary/10 text-primary text-xs px-1.5 py-0.5 rounded font-mono">
          {event.tool_name}
        </span>
      )}
      {event.model && (
        <span className="text-xs text-muted">{event.model.replace("claude-", "")}</span>
      )}
      {event.input_tokens != null && (
        <span className="text-xs text-muted ml-auto">{formatTokens(event.input_tokens + (event.output_tokens ?? 0))} tok</span>
      )}
      {event.cost_usd != null && event.cost_usd > 0 && (
        <span className="text-xs text-muted">{formatCost(event.cost_usd)}</span>
      )}
    </button>
  );
}
