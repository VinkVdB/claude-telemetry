import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import { SessionTable } from "../components/SessionTable";
import type { Project, Session } from "../lib/types";

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    if (!id) return;
    api.projects.get(id).then(setProject);
    api.sessions.list(id).then(setSessions);
  }, [id]);

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
      <SessionTable sessions={sessions} />
    </div>
  );
}
