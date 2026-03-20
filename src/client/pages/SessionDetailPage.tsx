import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import { AgentTimeline } from "../components/AgentTimeline";
import { TraceView } from "../components/TraceView";
import { AgentGraph } from "../components/AgentGraph";
import { CostBreakdownPanel } from "../components/CostBreakdownPanel";
import { useSSE } from "../lib/sse";
import { formatTokens, formatCost, cn } from "../lib/utils";
import type { Session, Event, Agent, CostBreakdown } from "../lib/types";

type Tab = "agents" | "graph-trace";

export function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [costs, setCosts] = useState<CostBreakdown[]>([]);
  const [tab, setTab] = useState<Tab>("agents");
  const [live, setLive] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);

  const fetchData = useCallback(async () => {
    if (!id) return;
    const [sess, evtResult, agts, costData] = await Promise.all([
      api.sessions.get(id),
      api.events.list({ sessionId: id, limit: "10000" }),
      api.agents.list(id),
      api.sessions.costs(id).catch(() => [] as CostBreakdown[]),
    ]);
    setSession(sess);
    setEvents(evtResult.events);
    setAgents(agts);
    setCosts(costData);
    setLive(true);
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useSSE((event, data) => {
    if (event === "event" && data.sessionId === id) {
      fetchData();
      setRefreshSignal(s => s + 1);
    }
  });

  if (!session) return <p className="text-muted animate-pulse">Loading...</p>;

  const totalTokens = session.total_input_tokens + session.total_output_tokens;
  const tabs: { key: Tab; label: string }[] = [
    { key: "agents", label: "Agents" },
    { key: "graph-trace", label: "Graph & Trace" },
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

      <div className="flex items-center gap-6 mb-2">
        <h1 className="text-2xl font-semibold text-primary-dark">{session.slug || "Session"}</h1>
        <div className="flex gap-4 text-sm">
          <span className="text-muted">Tokens: <strong className="text-primary-dark">{formatTokens(totalTokens)}</strong></span>
          <span className="text-muted">Cost: <strong className="text-primary-dark">{formatCost(session.total_cost_usd)}</strong></span>
          <span className="text-muted">Events: <strong className="text-primary-dark">{events.length}</strong></span>
          {agents.length > 0 && (
            <span className="text-muted">Agents: <strong className="text-primary-dark">{agents.length}</strong></span>
          )}
        </div>
        {live && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-green-600">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Live
          </span>
        )}
      </div>

      <CostBreakdownPanel
        totalInputTokens={session.total_input_tokens}
        totalOutputTokens={session.total_output_tokens}
        totalCacheRead={session.total_cache_read}
        totalCacheCreation={session.total_cache_creation}
        totalCost={session.total_cost_usd}
        perModel={costs}
      />

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

      {tab === "agents" && <AgentTimeline agents={agents} events={events} sessionId={id!} refreshSignal={refreshSignal} />}
      {tab === "graph-trace" && (
        <div className="space-y-6">
          <TraceView events={events} agents={agents} />
          <AgentGraph agents={agents} events={events} />
        </div>
      )}
    </div>
  );
}
