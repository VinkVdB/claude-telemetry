import { Link } from "react-router-dom";
import type { Project } from "../lib/types";
import { formatTokens, formatCost, timeAgo } from "../lib/utils";

export function ProjectCard({ project }: { project: Project }) {
  return (
    <Link
      to={`/projects/${encodeURIComponent(project.id)}`}
      className="block border border-border rounded-xl p-5 hover:border-primary/40 hover:shadow-md transition-all duration-200 bg-white"
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-semibold text-primary-dark text-lg">{project.name}</h3>
        <span className="text-xs text-muted">{timeAgo(project.last_active)}</span>
      </div>
      <p className="text-xs text-muted truncate mb-4">{project.path}</p>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-lg font-semibold text-primary">{project.session_count}</p>
          <p className="text-xs text-muted">Sessions</p>
        </div>
        <div>
          <p className="text-lg font-semibold text-primary">{formatTokens(project.total_tokens)}</p>
          <p className="text-xs text-muted">Tokens</p>
        </div>
        <div>
          <p className="text-lg font-semibold text-primary">{formatCost(project.total_cost)}</p>
          <p className="text-xs text-muted">Cost</p>
        </div>
      </div>
    </Link>
  );
}
