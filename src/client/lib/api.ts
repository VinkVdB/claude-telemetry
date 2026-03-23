import type { Project, Session, Event, Agent, CostBreakdown, AgentSummary, EventQueryFilters } from "./types";

const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || `API error: ${res.status}`);
  }
  return res.json();
}

export const api = {
  projects: {
    list: () => get<Project[]>("/projects"),
    get: (id: string) => get<Project>(`/projects/${encodeURIComponent(id)}`),
    costs: (id: string) => get<CostBreakdown[]>(`/projects/${encodeURIComponent(id)}/costs`),
  },
  sessions: {
    list: (projectId: string) => get<Session[]>(`/sessions?projectId=${encodeURIComponent(projectId)}`),
    get: (id: string) => get<Session>(`/sessions/${id}`),
    costs: (id: string) => get<CostBreakdown[]>(`/sessions/${id}/costs`),
    agentSummaries: (id: string) => get<AgentSummary[]>(`/sessions/${id}/agent-summaries`),
  },
  events: {
    query: (filters: EventQueryFilters) =>
      post<{ events: Event[]; total: number }>("/events/query", filters),
  },
  agents: {
    list: (sessionId: string) => get<Agent[]>(`/agents/${sessionId}`),
  },
  settings: {
    get: () => get<Record<string, any>>("/settings"),
    update: async (updates: Record<string, any>) => {
      const res = await fetch(`${BASE}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `API error: ${res.status}`);
      }
      return res.json() as Promise<Record<string, any>>;
    },
    reset: async (keys?: string[]) => {
      const res = await fetch(`${BASE}/settings/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys }),
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      return res.json() as Promise<Record<string, any>>;
    },
  },
};
