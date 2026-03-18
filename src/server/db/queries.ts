// src/server/db/queries.ts
import type { Database } from "bun:sqlite";

// --- Upserts for ingestion ---

export function upsertProject(db: Database, id: string, name: string, path: string): void {
  db.run(
    `INSERT INTO projects (id, name, path, last_active)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       last_active = datetime('now'),
       path = CASE WHEN excluded.path NOT LIKE '-%' THEN excluded.path ELSE projects.path END,
       name = CASE WHEN excluded.path NOT LIKE '-%' THEN excluded.name ELSE projects.name END`,
    [id, name, path]
  );
}

export function upsertSession(
  db: Database,
  id: string,
  projectId: string,
  data: { gitBranch?: string; slug?: string; startedAt?: string }
): void {
  db.run(
    `INSERT INTO sessions (id, project_id, git_branch, slug, started_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       git_branch = COALESCE(excluded.git_branch, sessions.git_branch),
       slug = COALESCE(excluded.slug, sessions.slug)`,
    [id, projectId, data.gitBranch ?? null, data.slug ?? null, data.startedAt ?? null]
  );
}

export function insertEvent(
  db: Database,
  event: {
    id: string;
    sessionId: string;
    parentId?: string;
    type: string;
    timestamp: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    costUsd?: number;
    durationMs?: number;
    toolName?: string;
    stopReason?: string;
    content?: string;
    raw?: string;
  }
): void {
  db.run(
    `INSERT OR IGNORE INTO events
     (id, session_id, parent_id, type, timestamp, model,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
      cost_usd, duration_ms, tool_name, stop_reason, content, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.id, event.sessionId, event.parentId ?? null,
      event.type, event.timestamp, event.model ?? null,
      event.inputTokens ?? null, event.outputTokens ?? null,
      event.cacheReadTokens ?? null, event.cacheCreationTokens ?? null,
      event.costUsd ?? null, event.durationMs ?? null,
      event.toolName ?? null, event.stopReason ?? null,
      event.content ?? null, event.raw ?? null,
    ]
  );
}

export function updateSessionAggregates(db: Database, sessionId: string): void {
  db.run(
    `UPDATE sessions SET
       total_input_tokens = (SELECT COALESCE(SUM(input_tokens), 0) FROM events WHERE session_id = ?),
       total_output_tokens = (SELECT COALESCE(SUM(output_tokens), 0) FROM events WHERE session_id = ?),
       total_cache_read = (SELECT COALESCE(SUM(cache_read_tokens), 0) FROM events WHERE session_id = ?),
       total_cache_creation = (SELECT COALESCE(SUM(cache_creation_tokens), 0) FROM events WHERE session_id = ?),
       total_cost_usd = (SELECT COALESCE(SUM(cost_usd), 0) FROM events WHERE session_id = ?),
       models_used = (SELECT json_group_array(DISTINCT model) FROM events WHERE session_id = ? AND model IS NOT NULL)
     WHERE id = ?`,
    [sessionId, sessionId, sessionId, sessionId, sessionId, sessionId, sessionId]
  );
}

export function upsertAgent(
  db: Database,
  agent: {
    id: string;
    sessionId: string;
    parentSession?: string;
    agentType?: string;
    startedAt?: string;
    description?: string;
  }
): void {
  db.run(
    `INSERT INTO agents (id, session_id, parent_session, agent_type, started_at, description)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       agent_type = COALESCE(excluded.agent_type, agents.agent_type),
       ended_at = COALESCE(excluded.ended_at, agents.ended_at)`,
    [agent.id, agent.sessionId, agent.parentSession ?? null,
     agent.agentType ?? null, agent.startedAt ?? null, agent.description ?? null]
  );
}

// --- Cursor tracking for incremental ingestion ---

export function getCursor(db: Database, filePath: string): { byteOffset: number; lineCount: number } | null {
  const row = db.query("SELECT byte_offset, line_count FROM ingest_cursors WHERE file_path = ?").get(filePath) as any;
  return row ? { byteOffset: row.byte_offset, lineCount: row.line_count } : null;
}

export function setCursor(db: Database, filePath: string, byteOffset: number, lineCount: number): void {
  db.run(
    `INSERT INTO ingest_cursors (file_path, byte_offset, line_count, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(file_path) DO UPDATE SET
       byte_offset = excluded.byte_offset,
       line_count = excluded.line_count,
       updated_at = datetime('now')`,
    [filePath, byteOffset, lineCount]
  );
}

// --- Read queries for API ---

export function listProjects(db: Database) {
  return db.query(`
    SELECT p.*,
      (SELECT COUNT(*) FROM sessions WHERE project_id = p.id) as session_count,
      (SELECT COALESCE(SUM(total_cost_usd), 0) FROM sessions WHERE project_id = p.id) as total_cost,
      (SELECT COALESCE(SUM(total_input_tokens + total_output_tokens + total_cache_read + total_cache_creation), 0)
       FROM sessions WHERE project_id = p.id) as total_tokens
    FROM projects p
    ORDER BY p.last_active DESC
  `).all();
}

export function getProject(db: Database, id: string) {
  return db.query("SELECT * FROM projects WHERE id = ?").get(id);
}

export function listSessions(db: Database, projectId: string) {
  return db.query(`
    SELECT s.*,
      (SELECT COUNT(*) FROM agents WHERE session_id = s.id) as agent_count,
      (SELECT COUNT(*) FROM events WHERE session_id = s.id) as event_count
    FROM sessions s
    WHERE s.project_id = ?
    ORDER BY s.started_at DESC
  `).all(projectId);
}

export function getSession(db: Database, id: string) {
  return db.query("SELECT * FROM sessions WHERE id = ?").get(id);
}

export function listEvents(
  db: Database,
  filters: {
    sessionId?: string;
    type?: string;
    model?: string;
    toolName?: string;
    limit?: number;
    offset?: number;
  }
) {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.sessionId) { conditions.push("session_id = ?"); params.push(filters.sessionId); }
  if (filters.type) { conditions.push("type = ?"); params.push(filters.type); }
  if (filters.model) { conditions.push("model = ?"); params.push(filters.model); }
  if (filters.toolName) { conditions.push("tool_name = ?"); params.push(filters.toolName); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;

  return {
    events: db.query(`SELECT * FROM events ${where} ORDER BY timestamp ASC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset),
    total: (db.query(`SELECT COUNT(*) as c FROM events ${where}`).get(...params) as any).c,
  };
}

export function listAgents(db: Database, sessionId: string) {
  return db.query(`
    SELECT a.*,
      (SELECT COUNT(*) FROM events WHERE session_id = a.session_id) as event_count,
      (SELECT COALESCE(SUM(input_tokens + output_tokens), 0) FROM events WHERE session_id = a.session_id) as total_tokens
    FROM agents a
    WHERE a.session_id = ? OR a.parent_session = ?
    ORDER BY a.started_at ASC
  `).all(sessionId, sessionId);
}
