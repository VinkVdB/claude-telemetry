import type { Project, Session, Event, Agent } from "./types";

const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const api = {
  projects: {
    list: () => get<Project[]>("/projects"),
    get: (id: string) => get<Project>(`/projects/${encodeURIComponent(id)}`),
  },
  sessions: {
    list: (projectId: string) => get<Session[]>(`/sessions?projectId=${encodeURIComponent(projectId)}`),
    get: (id: string) => get<Session>(`/sessions/${id}`),
  },
  events: {
    list: (params: Record<string, string>) => {
      const qs = new URLSearchParams(params).toString();
      return get<{ events: Event[]; total: number }>(`/events?${qs}`);
    },
  },
  agents: {
    list: (sessionId: string) => get<Agent[]>(`/agents/${sessionId}`),
  },
};
