export interface Project {
  id: string;
  name: string;
  path: string;
  last_active: string;
  session_count: number;
  total_cost: number;
  total_tokens: number;
}

export interface Session {
  id: string;
  project_id: string;
  git_branch: string | null;
  started_at: string;
  ended_at: string | null;
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
  id: string;
  session_id: string;
  parent_id: string | null;
  type: string;
  timestamp: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  cost_usd: number | null;
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
}
