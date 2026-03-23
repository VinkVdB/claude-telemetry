import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ProjectCard } from "../components/ProjectCard";
import { useSSE } from "../lib/sse";
import type { Project } from "../lib/types";

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => api.projects.list().then(setProjects).finally(() => setLoading(false));

  useEffect(() => { load(); }, []);
  useSSE(() => { load(); }); // Refresh on new events

  if (loading) return <p className="text-muted animate-pulse">Loading projects...</p>;
  if (projects.length === 0) return (
    <div className="text-center py-20">
      <h2 className="text-xl font-semibold text-primary-dark mb-2">No projects yet</h2>
      <p className="text-muted">Start a Claude Code session and data will appear here.</p>
    </div>
  );

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary-dark mb-4">Projects</h1>
      <div className="mb-6 flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
        <span className="mt-0.5 shrink-0">⚠️</span>
        <span>
          <strong>Data may not be exact.</strong> Due to a Claude Code bug, <code>output_tokens</code> and <code>input_tokens</code> are often recorded incorrectly in JSONL logs. Cache token fields are accurate. Costs are useful for relative comparisons but may understate actual spend — check your{" "}
          <a href="https://console.anthropic.com/usage" target="_blank" rel="noopener noreferrer" className="underline hover:text-yellow-900">Anthropic usage dashboard</a>{" "}
          for authoritative figures.
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => <ProjectCard key={p.id} project={p} />)}
      </div>
    </div>
  );
}
