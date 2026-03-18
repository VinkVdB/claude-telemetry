// src/client/components/AgentTimeline.tsx
import { useState } from "react";
import type { Event, Agent } from "../lib/types";
import { DetailPanel } from "./DetailPanel";
import { formatTokens, formatCost, cn } from "../lib/utils";

const AGENT_COLORS = ["#00a2e0", "#bdd72d", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];

export function AgentTimeline({ agents, events }: { agents: Agent[]; events: Event[] }) {
  const [selected, setSelected] = useState<Event | null>(null);

  // Group events by agent (main session + subagents)
  const mainEvents = events.filter((e) => e.type === "assistant" || (e.type === "user" && e.tool_name));

  return (
    <div className="relative">
      {agents.length === 0 ? (
        <div className="space-y-2">
          {mainEvents.map((e) => (
            <EventRow key={e.id} event={e} color="#00a2e0" onClick={() => setSelected(e)} />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {agents.map((agent, i) => {
            const color = AGENT_COLORS[i % AGENT_COLORS.length];
            const agentEvents = events.filter((e) => e.session_id === agent.session_id && e.type === "assistant");
            return (
              <div key={agent.id}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-sm font-medium text-primary-dark">{agent.agent_type ?? "agent"}</span>
                  {agent.description && <span className="text-xs text-muted">— {agent.description}</span>}
                  <span className="text-xs text-muted ml-auto">{formatTokens(agent.total_tokens)} tokens</span>
                </div>
                <div className="ml-5 border-l-2 pl-4 space-y-1" style={{ borderColor: color }}>
                  {agentEvents.map((e) => (
                    <EventRow key={e.id} event={e} color={color} onClick={() => setSelected(e)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <DetailPanel event={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function EventRow({ event, color, onClick }: { event: Event; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface transition-colors text-sm"
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
