import { useState } from "react";
import { Link } from "react-router-dom";
import type { Project } from "../lib/types";
import { api } from "../lib/api";
import { formatTokens, formatCost, timeAgo } from "../lib/utils";
import { useSettings } from "../contexts/SettingsContext";
import { useToast } from "../hooks/useToast";

export function ProjectCard({ project, onUpdated }: { project: Project; onUpdated?: (p: Project) => void }) {
  const { settings } = useSettings();
  const formatOpts = {
    kThreshold: settings["display.tokenKThreshold"] as number,
    mThreshold: settings["display.tokenMThreshold"] as number,
    costPrecisionThreshold: settings["display.costPrecisionThreshold"] as number,
    timeAgoJustNow: settings["display.timeAgoJustNow"] as number,
    timeAgoMinutes: settings["display.timeAgoMinutes"] as number,
    timeAgoHours: settings["display.timeAgoHours"] as number,
  };

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editPath, setEditPath] = useState(project.path);
  const [saving, setSaving] = useState(false);
  const { showToast, ToastNode } = useToast();

  const startEdit = (e: React.MouseEvent) => {
    e.preventDefault();
    setEditName(project.name);
    setEditPath(project.path);
    setEditing(true);
  };

  const cancel = (e: React.MouseEvent) => {
    e.preventDefault();
    setEditing(false);
  };

  const save = async (e: React.MouseEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api.projects.update(project.id, { name: editName, path: editPath });
      onUpdated?.(updated as Project);
      setEditing(false);
      showToast("Project updated");
    } catch {
      showToast("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="block border border-primary/40 rounded-xl p-5 bg-white shadow-md">
        <div className="space-y-3 mb-4">
          <div>
            <label className="text-xs text-muted block mb-1">Name</label>
            <input
              className="w-full border border-border rounded-lg px-3 py-1.5 text-sm text-primary-dark focus:outline-none focus:border-primary"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Path</label>
            <input
              className="w-full border border-border rounded-lg px-3 py-1.5 text-sm text-primary-dark font-mono focus:outline-none focus:border-primary"
              value={editPath}
              onChange={e => setEditPath(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={saving || !editName.trim()}
            className="flex-1 py-1.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={cancel}
            className="flex-1 py-1.5 text-sm font-medium text-muted border border-border rounded-lg hover:text-primary-dark transition-colors"
          >
            Cancel
          </button>
        </div>
        {ToastNode}
      </div>
    );
  }

  return (
    <div className="relative group">
      <Link
        to={`/projects/${encodeURIComponent(project.id)}`}
        className="block border border-border rounded-xl p-5 hover:border-primary/40 hover:shadow-md transition-all duration-200 bg-white"
      >
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-semibold text-primary-dark text-lg">{project.name}</h3>
          <span className="text-xs text-muted">{timeAgo(project.last_active, formatOpts)}</span>
        </div>
        <p className="text-xs text-muted truncate mb-4">{project.path}</p>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-lg font-semibold text-primary">{project.session_count}</p>
            <p className="text-xs text-muted">Sessions</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-primary">{formatTokens(project.total_tokens, formatOpts)}</p>
            <p className="text-xs text-muted">Tokens</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-primary">{formatCost(project.total_cost, formatOpts)}</p>
            <p className="text-xs text-muted">Cost</p>
          </div>
        </div>
      </Link>
      <button
        onClick={startEdit}
        title="Rename project"
        className="absolute top-3 right-14 opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-primary-dark p-1"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
      {ToastNode}
    </div>
  );
}
