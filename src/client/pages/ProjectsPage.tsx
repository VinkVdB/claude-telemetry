import { useEffect, useState, useMemo } from "react";
import { api } from "../lib/api";
import { ProjectCard } from "../components/ProjectCard";
import { useSSE } from "../lib/sse";
import type { Project } from "../lib/types";

type SortKey = "last_active" | "total_cost" | "total_tokens" | "name";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "last_active", label: "Last active" },
  { key: "total_cost", label: "Cost" },
  { key: "total_tokens", label: "Tokens" },
  { key: "name", label: "Name" },
];

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>("last_active");

  const load = () => api.projects.list().then(setProjects).finally(() => setLoading(false));

  useEffect(() => { load(); }, []);
  useSSE(() => { load(); });

  const sorted = useMemo(() => {
    return [...projects].sort((a, b) => {
      switch (sort) {
        case "last_active":
          return (b.last_active ?? "").localeCompare(a.last_active ?? "");
        case "total_cost":
          return (b.total_cost ?? 0) - (a.total_cost ?? 0);
        case "total_tokens":
          return (b.total_tokens ?? 0) - (a.total_tokens ?? 0);
        case "name":
          return a.name.localeCompare(b.name);
      }
    });
  }, [projects, sort]);

  if (loading) return <p className="text-muted animate-pulse">Loading projects...</p>;
  if (projects.length === 0) return (
    <div className="text-center py-20">
      <h2 className="text-xl font-semibold text-primary-dark mb-2">No projects yet</h2>
      <p className="text-muted">Start a Claude Code session and data will appear here.</p>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold text-primary-dark">Projects</h1>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted">Sort by:</span>
          {SORT_OPTIONS.map(o => (
            <button
              key={o.key}
              onClick={() => setSort(o.key)}
              className={`px-3 py-1 rounded-full border text-sm transition-colors ${
                sort === o.key
                  ? "bg-primary text-white border-primary"
                  : "border-border text-muted hover:text-primary-dark hover:border-primary/40"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-6 flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
        <span className="mt-0.5 shrink-0">⚠️</span>
        <span>
          <strong>Data may not be exact.</strong> Due to a Claude Code bug, <code>output_tokens</code> and <code>input_tokens</code> are often recorded incorrectly in JSONL logs. Cache token fields are accurate. Costs are useful for relative comparisons but may understate actual spend — check your{" "}
          <a href="https://console.anthropic.com/usage" target="_blank" rel="noopener noreferrer" className="underline hover:text-yellow-900">Anthropic usage dashboard</a>{" "}
          for authoritative figures.
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sorted.map((p) => (
          <ProjectCard key={p.id} project={p} onUpdated={(updated) => setProjects(prev => prev.map(x => x.id === updated.id ? updated : x))} />
        ))}
      </div>
    </div>
  );
}
