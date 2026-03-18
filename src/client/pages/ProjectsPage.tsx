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
      <h1 className="text-2xl font-semibold text-primary-dark mb-6">Projects</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => <ProjectCard key={p.id} project={p} />)}
      </div>
    </div>
  );
}
