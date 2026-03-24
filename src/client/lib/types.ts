export interface Project {
  id: string;
  name: string;
  path: string;
  last_active: string;
  session_count: number;
  total_cost: number;
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read: number;
  total_cache_creation: number;
}

export interface CostBreakdown {
  model: string;
  event_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
  otel_cost_usd?: number | null;
  otel_event_count?: number;
}

export interface Session {
  id: string;
  project_id: string;
  git_branch: string | null;
  started_at: string;
  ended_at: string | null;
  last_updated: string | null;
  slug: string | null;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read: number;
  total_cache_creation: number;
  total_cost_usd: number;
  models_used: string; // JSON array
  agent_count: number;
  event_count: number;
}

export interface Event {
  seq: number;  // SQLite rowid — stable DB-assigned sequence number
  id: string;
  session_id: string;
  agent_id: string | null;
  parent_id: string | null;
  type: string;
  timestamp: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  cost_usd: number | null;
  otel_cost_usd: number | null;
  duration_ms: number | null;
  tool_name: string | null;
  stop_reason: string | null;
  content: string | null; // JSON string
  raw: string | null;     // Full JSONL line
}

export interface Agent {
  id: string;
  session_id: string;
  parent_session: string | null;
  agent_type: string | null;
  started_at: string | null;
  ended_at: string | null;
  description: string | null;
  event_count: number;
  total_tokens: number;
  chain_id: string | null;
}

/** UI-side filter shape — agentIds may contain null (representing the "main" agent with no agent_id) */
export interface UIEventFilters {
  sessionId?: string;
  type?: string;
  model?: string;
  toolName?: string;
  agentIds?: (string | null)[];
  search?: string;
  limit?: number;
  offset?: number;
}

/** Wire format sent to POST /api/events/query — no null values in agentIds */
export interface EventQueryFilters {
  sessionId?: string;
  type?: string;
  model?: string;
  toolName?: string;
  agentIds?: string[];  // null replaced by "__main__" sentinel by useInfiniteEvents hook
  search?: string;
  limit?: number;
  offset?: number;
}

/** Per-agent aggregated summary returned by GET /api/sessions/:id/agent-summaries */
export interface AgentSummary {
  id: string | null;
  agent_type: string | null;
  description: string | null;
  started_at: string | null;
  event_count: number;
  total_tokens: number;
  last_active: string | null;
  last_model: string | null;
  turn_count: number | null;
  chain_id: string | null;
}
