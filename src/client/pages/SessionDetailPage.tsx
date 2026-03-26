import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import { AgentTimeline } from "../components/AgentTimeline";
import { TraceView } from "../components/TraceView";
import { AgentGraph } from "../components/AgentGraph";
import { CostBreakdownPanel } from "../components/CostBreakdownPanel";
import { useSSE } from "../lib/sse";
import { useToast } from "../hooks/useToast";
import { formatTokens, formatCost, cn } from "../lib/utils";
import type { Session, Event, Agent, CostBreakdown, AgentSummary, Project } from "../lib/types";

type Tab = "agents" | "graph-trace";

export function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [agentSummaries, setAgentSummaries] = useState<AgentSummary[]>([]);
  const [costs, setCosts] = useState<CostBreakdown[]>([]);
  const [tab, setTab] = useState<Tab>("agents");
  const [live, setLive] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editSlug, setEditSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const { showToast, ToastNode } = useToast();

  // Graph & Trace: lazy-loaded only when that tab is first opened
  const [graphEvents, setGraphEvents] = useState<Event[]>([]);
  const [graphAgents, setGraphAgents] = useState<Agent[]>([]);
  const [graphLoaded, setGraphLoaded] = useState(false);

  const fetchCore = useCallback(async () => {
    if (!id) return;
    const sess = await api.sessions.get(id);
    setSession(sess);
    const [summaries, costData, proj] = await Promise.all([
      api.sessions.agentSummaries(id),
      api.sessions.costs(id).catch(() => [] as CostBreakdown[]),
      api.projects.get(sess.project_id).catch(() => null),
    ]);
    setAgentSummaries(summaries);
    setCosts(costData);
    setProject(proj);
    setLive(true);
  }, [id]);

  useEffect(() => { fetchCore(); }, [fetchCore]);

  // Lazy-load Graph & Trace data when that tab becomes active
  useEffect(() => {
    if (tab !== "graph-trace" || graphLoaded || !id) return;
    Promise.all([
      api.events.query({ sessionId: id, limit: 5000, offset: 0 }),
      api.agents.list(id),
    ]).then(([evtResult, agts]) => {
      setGraphEvents(evtResult.events);
      setGraphAgents(agts);
      setGraphLoaded(true);
    });
  }, [tab, graphLoaded, id]);

  // Incremental SSE: update header stats and append new graph events without resetting
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graphEventsRef = useRef(graphEvents);
  graphEventsRef.current = graphEvents;
  const graphLoadedRef = useRef(graphLoaded);
  graphLoadedRef.current = graphLoaded;

  useSSE((event, data) => {
    if (event === "event" && data.sessionId === id) {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(async () => {
        refreshTimerRef.current = null;
        if (!id) return;

        // Refresh session metadata + agent summaries (lightweight, keeps header stats current)
        const [sess, summaries, costData] = await Promise.all([
          api.sessions.get(id),
          api.sessions.agentSummaries(id),
          api.sessions.costs(id).catch(() => [] as CostBreakdown[]),
        ]);
        setSession(sess);
        setAgentSummaries(summaries);
        setCosts(costData);

        // If graph tab data is loaded, append new events incrementally
        if (graphLoadedRef.current) {
          const currentCount = graphEventsRef.current.length;
          const [evtResult, agts] = await Promise.all([
            api.events.query({ sessionId: id, limit: 5000, offset: 0 }),
            api.agents.list(id),
          ]);
          // Only update if there are actually new events (avoids unnecessary re-renders)
          if (evtResult.events.length !== currentCount) {
            setGraphEvents(evtResult.events);
          }
          setGraphAgents(agts);
        }
      }, 800);
    }
  });

  const startEdit = () => {
    setEditSlug(session?.custom_slug || session?.slug || session?.id.slice(0, 8) || "");
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const saveSlug = async () => {
    if (!id || !editSlug.trim()) return;
    setSaving(true);
    try {
      await api.sessions.update(id, { slug: editSlug.trim() });
      setSession((s) => s ? { ...s, slug: editSlug.trim() } : s);
      setEditing(false);
      showToast("Session renamed");
    } catch {
      showToast("Failed to rename");
    } finally {
      setSaving(false);
    }
  };

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
          {project?.name ?? session.project_id.split("/").pop() ?? session.project_id}
        </Link>
        <span>/</span>
        <span className="text-primary-dark font-medium">{
          (session.custom_slug || session.slug || session.id.slice(0, 8)).length > 50
            ? (session.custom_slug || session.slug || session.id.slice(0, 8)).slice(0, 50) + "\u2026"
            : (session.custom_slug || session.slug || session.id.slice(0, 8))
        }</span>
      </div>

      <div className="flex items-center gap-6 mb-2">
        <div className="flex items-center gap-1.5 group/title">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                className="border border-border rounded-lg px-3 py-1 text-xl font-semibold text-primary-dark focus:outline-none focus:border-primary"
                value={editSlug}
                onChange={(e) => setEditSlug(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveSlug();
                  if (e.key === "Escape") cancelEdit();
                }}
                autoFocus
              />
              <button
                onClick={saveSlug}
                disabled={saving || !editSlug.trim()}
                className="px-3 py-1 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={cancelEdit}
                className="px-3 py-1 text-sm font-medium text-muted border border-border rounded-lg hover:text-primary-dark transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-semibold text-primary-dark" title={session.custom_slug || session.slug || session.id}>
                {(session.custom_slug || session.slug || "Session").length > 50
                  ? (session.custom_slug || session.slug || "Session").slice(0, 50) + "\u2026"
                  : (session.custom_slug || session.slug || "Session")}
              </h1>
              <button
                onClick={startEdit}
                title="Rename session"
                className="shrink-0 opacity-0 group-hover/title:opacity-100 transition-opacity text-muted hover:text-primary-dark p-0.5 rounded"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
            </>
          )}
        </div>
        <div className="flex gap-4 text-sm">
          <span className="text-muted">Tokens: <strong className="text-primary-dark">{formatTokens(totalTokens)}</strong></span>
          <span className="text-muted">Cost: <strong className="text-primary-dark">{formatCost(session.total_cost_usd)}</strong></span>
          <span className="text-muted">Events: <strong className="text-primary-dark">{session.event_count}</strong></span>
          {agentSummaries.length > 1 && (
            <span className="text-muted">Agents: <strong className="text-primary-dark">{new Set(agentSummaries.filter(s => s.id !== null).map(s => s.chain_id ?? s.id)).size}</strong></span>
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

      {tab === "agents" && (
        <AgentTimeline
          agentSummaries={agentSummaries}
          sessionId={id!}
        />
      )}
      {tab === "graph-trace" && (
        <div className="space-y-6">
          {session.event_count > 5000 && (
            <div className="border border-amber-300 bg-amber-50 rounded-lg px-4 py-2 text-sm text-amber-800">
              This session has {session.event_count.toLocaleString()} events. Graph & Trace is limited to the first 5,000 events.
            </div>
          )}
          {!graphLoaded ? (
            <p className="text-muted text-sm animate-pulse">Loading graph data...</p>
          ) : (
            <>
              <TraceView events={graphEvents} agents={graphAgents} />
              <AgentGraph agents={graphAgents} events={graphEvents} />
            </>
          )}
        </div>
      )}
      {ToastNode}
    </div>
  );
}
