import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import { AgentTimeline } from "../components/AgentTimeline";
import { TraceView } from "../components/TraceView";
import { AgentGraph } from "../components/AgentGraph";
import { formatTokens, formatCost, cn } from "../lib/utils";
import type { Session, Event, Agent } from "../lib/types";

type Tab = "agents" | "trace" | "graph";

export function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tab, setTab] = useState<Tab>("agents");

  useEffect(() => {
    if (!id) return;
    api.sessions.get(id).then(setSession);
    api.events.list({ sessionId: id, limit: "10000" }).then((r) => setEvents(r.events));
    api.agents.list(id).then(setAgents);
  }, [id]);

  if (!session) return <p className="text-muted animate-pulse">Loading...</p>;

  const totalTokens = session.total_input_tokens + session.total_output_tokens;
  const tabs: { key: Tab; label: string }[] = [
    { key: "agents", label: "Agents" },
    { key: "trace", label: "Trace" },
    { key: "graph", label: "Graph" },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-muted mb-4">
        <Link to="/" className="hover:text-primary">Projects</Link>
        <span>/</span>
        <Link to={`/projects/${encodeURIComponent(session.project_id)}`} className="hover:text-primary">
          {session.project_id.split("-").pop()}
        </Link>
        <span>/</span>
        <span className="text-primary-dark font-medium">{session.slug || session.id.slice(0, 8)}</span>
      </div>

      <div className="flex items-center gap-6 mb-6">
        <h1 className="text-2xl font-semibold text-primary-dark">{session.slug || "Session"}</h1>
        <div className="flex gap-4 text-sm">
          <span className="text-muted">Tokens: <strong className="text-primary-dark">{formatTokens(totalTokens)}</strong></span>
          <span className="text-muted">Cost: <strong className="text-primary-dark">{formatCost(session.total_cost_usd)}</strong></span>
          <span className="text-muted">Events: <strong className="text-primary-dark">{events.length}</strong></span>
        </div>
      </div>

      <div className="flex gap-1 mb-4 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === t.key ? "border-primary text-primary" : "border-transparent text-muted hover:text-primary-dark"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "agents" && <AgentTimeline agents={agents} events={events} />}
      {tab === "trace" && <TraceView events={events} agents={agents} />}
      {tab === "graph" && <AgentGraph agents={agents} events={events} />}
    </div>
  );
}
