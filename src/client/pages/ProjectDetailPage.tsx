import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import { SessionTable } from "../components/SessionTable";
import { CostBreakdownPanel } from "../components/CostBreakdownPanel";
import { useSSE } from "../lib/sse";
import type { Project, Session, CostBreakdown } from "../lib/types";

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [costs, setCosts] = useState<CostBreakdown[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    if (!id) return;
    api.projects.get(id).then(setProject).catch((e) => setError(String(e)));
    api.sessions.list(id).then(setSessions).catch((e) => setError(String(e)));
    api.projects.costs(id).then(setCosts).catch(() => setCosts([]));
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useSSE((event) => {
    if (event === "event" || event === "session_new") {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => { refreshTimerRef.current = null; fetchData(); }, 800);
    }
  });

  if (error) return <p className="text-red-500 p-4">{error}</p>;
  if (!project) return <p className="text-muted animate-pulse">Loading...</p>;

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-muted mb-4">
        <Link to="/" className="hover:text-primary">Projects</Link>
        <span>/</span>
        <span className="text-primary-dark font-medium">{project.name}</span>
      </div>
      <h1 className="text-2xl font-semibold text-primary-dark mb-1">{project.name}</h1>
      <p className="text-sm text-muted mb-6">{project.path}</p>
      <CostBreakdownPanel
        totalInputTokens={project.total_input_tokens ?? 0}
        totalOutputTokens={project.total_output_tokens ?? 0}
        totalCacheRead={project.total_cache_read ?? 0}
        totalCacheCreation={project.total_cache_creation ?? 0}
        totalCost={project.total_cost ?? 0}
        perModel={costs}
      />
      <SessionTable sessions={sessions} />
    </div>
  );
}
