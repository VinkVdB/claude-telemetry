// src/server/db/queries.ts
import type { Database } from "bun:sqlite";
import { getModelPricing } from "../../shared/pricing";

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

export function updateProject(db: Database, id: string, updates: { name?: string; path?: string }): void {
  if (updates.name !== undefined) {
    db.run("UPDATE projects SET name = ? WHERE id = ?", [updates.name, id]);
  }
  if (updates.path !== undefined) {
    db.run("UPDATE projects SET path = ? WHERE id = ?", [updates.path, id]);
  }
}

export function updateSession(db: Database, id: string, data: { slug: string }): void {
  db.run("UPDATE sessions SET slug = ? WHERE id = ?", [data.slug, id]);
}

export function upsertSession(
  db: Database,
  id: string,
  projectId: string,
  data: { gitBranch?: string; slug?: string; startedAt?: string }
): void {
  if (!id) return; // Guard: never insert sessions with null/empty IDs
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
    messageId?: string;
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
    agentId?: string;
    chainId?: string;
  }
): void {
  db.run(
    `INSERT OR IGNORE INTO events
     (id, message_id, session_id, parent_id, type, timestamp, model,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
      cost_usd, duration_ms, tool_name, stop_reason, content, raw, agent_id, chain_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.id, event.messageId ?? null, event.sessionId, event.parentId ?? null,
      event.type, event.timestamp, event.model ?? null,
      event.inputTokens ?? null, event.outputTokens ?? null,
      event.cacheReadTokens ?? null, event.cacheCreationTokens ?? null,
      event.costUsd ?? null, event.durationMs ?? null,
      event.toolName ?? null, event.stopReason ?? null,
      event.content ?? null, event.raw ?? null,
      event.agentId ?? null, event.chainId ?? null,
    ]
  );
  // Backfill agent_id on existing events that were ingested before this column existed
  if (event.agentId) {
    db.run(`UPDATE events SET agent_id = ? WHERE id = ? AND agent_id IS NULL`, [event.agentId, event.id]);
  }
}

export function updateSessionAggregates(db: Database, sessionId: string): void {
  db.run(
    `UPDATE sessions SET
       total_input_tokens = (SELECT COALESCE(SUM(input_tokens), 0) FROM events WHERE session_id = ?),
       total_output_tokens = (SELECT COALESCE(SUM(output_tokens), 0) FROM events WHERE session_id = ?),
       total_cache_read = (SELECT COALESCE(SUM(cache_read_tokens), 0) FROM events WHERE session_id = ?),
       total_cache_creation = (SELECT COALESCE(SUM(cache_creation_tokens), 0) FROM events WHERE session_id = ?),
       models_used = (SELECT json_group_array(DISTINCT model) FROM events WHERE session_id = ? AND model IS NOT NULL)
     WHERE id = ?`,
    [sessionId, sessionId, sessionId, sessionId, sessionId, sessionId]
  );

  db.run("DELETE FROM session_costs WHERE session_id = ?", [sessionId]);

  db.run(
    `INSERT INTO session_costs (session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, otel_cost_usd, otel_event_count, event_count)
     SELECT
       session_id,
       model,
       SUM(COALESCE(input_tokens, 0)),
       SUM(COALESCE(output_tokens, 0)),
       SUM(COALESCE(cache_read_tokens, 0)),
       SUM(COALESCE(cache_creation_tokens, 0)),
       SUM(otel_cost_usd),
       COUNT(CASE WHEN otel_cost_usd IS NOT NULL THEN 1 END),
       COUNT(*)
     FROM events
     WHERE session_id = ? AND model IS NOT NULL
       AND (message_id IS NULL OR id = (
         SELECT id FROM events e2
         WHERE e2.message_id = events.message_id
         ORDER BY (COALESCE(e2.input_tokens,0) + COALESCE(e2.output_tokens,0) + COALESCE(e2.cache_read_tokens,0) + COALESCE(e2.cache_creation_tokens,0)) DESC
         LIMIT 1
       ))
     GROUP BY model`,
    [sessionId]
  );

  // Compute total_cost_usd from session_costs using OTEL-aware logic:
  // If all events for a model have OTEL cost data, use otel_cost_usd; otherwise use token-based pricing.
  const costRows = db
    .query(
      "SELECT model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, otel_cost_usd, otel_event_count, event_count FROM session_costs WHERE session_id = ?"
    )
    .all(sessionId) as Array<{
    model: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    otel_cost_usd: number | null;
    otel_event_count: number;
    event_count: number;
  }>;

  let totalCostUsd = 0;
  for (const row of costRows) {
    const isOtelComplete = row.otel_event_count > 0 && row.otel_event_count === row.event_count;
    if (isOtelComplete && row.otel_cost_usd != null) {
      totalCostUsd += row.otel_cost_usd;
    } else {
      const p = getModelPricing(row.model);
      if (p) {
        totalCostUsd +=
          (row.input_tokens / 1e6) * p.inputPerMToken +
          (row.output_tokens / 1e6) * p.outputPerMToken +
          (row.cache_read_tokens / 1e6) * p.cacheReadPerMToken +
          (row.cache_creation_tokens / 1e6) * p.cacheWritePerMToken;
      }
    }
  }

  db.run("UPDATE sessions SET total_cost_usd = ? WHERE id = ?", [totalCostUsd, sessionId]);
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
    chainId?: string;
  }
): void {
  db.run(
    `INSERT INTO agents (id, session_id, parent_session, agent_type, started_at, description, chain_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       agent_type   = COALESCE(excluded.agent_type,   agents.agent_type),
       ended_at     = COALESCE(excluded.ended_at,     agents.ended_at),
       description  = COALESCE(excluded.description,  agents.description),
       chain_id     = COALESCE(excluded.chain_id,     agents.chain_id)`,
    [agent.id, agent.sessionId, agent.parentSession ?? null,
     agent.agentType ?? null, agent.startedAt ?? null, agent.description ?? null,
     agent.chainId ?? null]
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

function projectWithStatsSQL(where?: string): string {
  return `
    SELECT p.*,
      (SELECT COUNT(*) FROM sessions WHERE project_id = p.id) as session_count,
      (SELECT COALESCE(SUM(total_cost_usd), 0) FROM sessions WHERE project_id = p.id) as total_cost,
      (SELECT COALESCE(SUM(total_input_tokens + total_output_tokens + total_cache_read + total_cache_creation), 0)
       FROM sessions WHERE project_id = p.id) as total_tokens,
      (SELECT COALESCE(SUM(total_input_tokens), 0) FROM sessions WHERE project_id = p.id) as total_input_tokens,
      (SELECT COALESCE(SUM(total_output_tokens), 0) FROM sessions WHERE project_id = p.id) as total_output_tokens,
      (SELECT COALESCE(SUM(total_cache_read), 0) FROM sessions WHERE project_id = p.id) as total_cache_read,
      (SELECT COALESCE(SUM(total_cache_creation), 0) FROM sessions WHERE project_id = p.id) as total_cache_creation
    FROM projects p
    ${where ?? ""}`;
}

export function listProjects(db: Database) {
  return db.query(projectWithStatsSQL() + "\n    ORDER BY p.last_active DESC").all();
}

export function getProject(db: Database, id: string) {
  return db.query(projectWithStatsSQL("WHERE p.id = ?")).get(id);
}

export function listSessions(db: Database, projectId: string) {
  return db.query(`
    SELECT s.*,
      (SELECT COUNT(*) FROM agents WHERE session_id = s.id) as agent_count,
      (SELECT COUNT(*) FROM events WHERE session_id = s.id) as event_count,
      (SELECT MAX(timestamp) FROM events WHERE session_id = s.id) as last_updated
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
    agentIds?: string[];  // "__main__" maps to agent_id IS NULL
    search?: string;      // FTS5 match
    limit?: number;
    offset?: number;
  }
) {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.sessionId) { conditions.push("e.session_id = ?"); params.push(filters.sessionId); }
  if (filters.type)      { conditions.push("e.type = ?");       params.push(filters.type); }
  if (filters.model)     { conditions.push("e.model LIKE ?");   params.push(filters.model + "%"); }
  if (filters.toolName)  { conditions.push("e.tool_name = ?");  params.push(filters.toolName); }

  if (filters.agentIds) {
    if (filters.agentIds.length === 0) {
      // No agents visible → return nothing
      conditions.push("1=0");
    } else {
      const hasMain = filters.agentIds.includes("__main__");
      // chain_id values (or plain agentIds for old records without chain_id)
      const realIds = filters.agentIds.filter(id => id !== "__main__");

      if (hasMain && realIds.length > 0) {
        const ph = realIds.map(() => "?").join(",");
        // Split into two index-friendly conditions — avoids COALESCE killing the index
        conditions.push(`(e.agent_id IS NULL OR e.chain_id IN (${ph}) OR (e.chain_id IS NULL AND e.agent_id IN (${ph})))`);
        params.push(...realIds, ...realIds);
      } else if (hasMain) {
        conditions.push("e.agent_id IS NULL");
      } else {
        const ph = realIds.map(() => "?").join(",");
        conditions.push(`(e.chain_id IN (${ph}) OR (e.chain_id IS NULL AND e.agent_id IN (${ph})))`);
        params.push(...realIds, ...realIds);
      }
    }
  }

  const limit  = Math.min(filters.limit  ?? 100, 1000);
  const offset = filters.offset ?? 0;

  // FTS5 search: join to events_fts virtual table
  const useFts = !!filters.search;
  const fromClause  = useFts
    ? "FROM events e JOIN events_fts fts ON e.rowid = fts.rowid"
    : "FROM events e";
  const ftsCondition = useFts ? ["events_fts MATCH ?"] : [];
  const ftsParams    = useFts ? [filters.search] : [];

  const allConditions = [...ftsCondition, ...conditions];
  const where = allConditions.length > 0 ? `WHERE ${allConditions.join(" AND ")}` : "";
  const allParams = [...ftsParams, ...params];

  return {
    events: db
      .query(`SELECT e.rowid as seq, e.* ${fromClause} ${where} ORDER BY e.timestamp DESC LIMIT ? OFFSET ?`)
      .all(...allParams, limit, offset),
    total: (db
      .query(`SELECT COUNT(*) as c ${fromClause} ${where}`)
      .get(...allParams) as any).c,
  };
}

/** Returns the pagination offset (position from newest) of the event with the given rowid,
 *  within the same filtered result set used by listEvents. */
export function getEventOffsetBySeq(
  db: Database,
  seq: number,
  filters: {
    sessionId?: string;
    type?: string;
    model?: string;
    toolName?: string;
    agentIds?: string[];
    search?: string;
  }
): number {
  const target = db.query("SELECT timestamp FROM events WHERE rowid = ?").get(seq) as { timestamp: string } | null;
  if (!target) return 0;

  const conditions: string[] = ["e.timestamp > ?"];
  const params: any[] = [target.timestamp];

  if (filters.sessionId) { conditions.push("e.session_id = ?"); params.push(filters.sessionId); }
  if (filters.type)      { conditions.push("e.type = ?");       params.push(filters.type); }
  if (filters.model)     { conditions.push("e.model LIKE ?");   params.push(filters.model + "%"); }
  if (filters.toolName)  { conditions.push("e.tool_name = ?");  params.push(filters.toolName); }

  if (filters.agentIds) {
    if (filters.agentIds.length === 0) {
      return 0;
    } else {
      const hasMain = filters.agentIds.includes("__main__");
      const realIds = filters.agentIds.filter(id => id !== "__main__");
      if (hasMain && realIds.length > 0) {
        const ph = realIds.map(() => "?").join(",");
        conditions.push(`(e.agent_id IS NULL OR e.chain_id IN (${ph}) OR (e.chain_id IS NULL AND e.agent_id IN (${ph})))`);
        params.push(...realIds, ...realIds);
      } else if (hasMain) {
        conditions.push("e.agent_id IS NULL");
      } else {
        const ph = realIds.map(() => "?").join(",");
        conditions.push(`(e.chain_id IN (${ph}) OR (e.chain_id IS NULL AND e.agent_id IN (${ph})))`);
        params.push(...realIds, ...realIds);
      }
    }
  }

  const useFts = !!filters.search;
  const fromClause = useFts ? "FROM events e JOIN events_fts fts ON e.rowid = fts.rowid" : "FROM events e";
  const ftsCondition = useFts ? ["events_fts MATCH ?"] : [];
  const ftsParams    = useFts ? [filters.search] : [];

  const allConditions = [...ftsCondition, ...conditions];
  const where = allConditions.length > 0 ? `WHERE ${allConditions.join(" AND ")}` : "";
  const allParams = [...ftsParams, ...params];

  const row = db.query(`SELECT COUNT(*) as c ${fromClause} ${where}`).get(...allParams) as any;
  return row.c;
}

export function getProjectCostBreakdown(db: Database, projectId: string) {
  return db.query(`
    SELECT
      sc.model,
      SUM(sc.input_tokens) as input_tokens,
      SUM(sc.output_tokens) as output_tokens,
      SUM(sc.cache_read_tokens) as cache_read_tokens,
      SUM(sc.cache_creation_tokens) as cache_creation_tokens,
      SUM(sc.otel_cost_usd) as otel_cost_usd,
      SUM(sc.otel_event_count) as otel_event_count,
      SUM(sc.event_count) as event_count
    FROM session_costs sc
    JOIN sessions s ON sc.session_id = s.id
    WHERE s.project_id = ?
    GROUP BY sc.model
    ORDER BY event_count DESC
  `).all(projectId);
}

export function getSessionCostBreakdown(db: Database, sessionId: string) {
  return db.query(`
    SELECT * FROM session_costs WHERE session_id = ? ORDER BY event_count DESC
  `).all(sessionId);
}

export function listAgents(db: Database, sessionId: string) {
  return db.query(`
    SELECT a.*,
      (SELECT COUNT(*) FROM events WHERE agent_id = a.id) as event_count,
      (SELECT COALESCE(SUM(input_tokens + output_tokens), 0) FROM events WHERE agent_id = a.id) as total_tokens
    FROM agents a
    WHERE a.session_id = ?
    ORDER BY a.started_at ASC
  `).all(sessionId);
}

export function listAgentSummaries(db: Database, sessionId: string) {
  return db.query(`
    SELECT
      NULL          as id,
      'main'        as agent_type,
      NULL          as description,
      NULL          as started_at,
      COUNT(*)      as event_count,
      COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens,
      MAX(timestamp) as last_active,
      (SELECT model FROM events
       WHERE session_id = ? AND agent_id IS NULL AND model IS NOT NULL
       ORDER BY timestamp DESC LIMIT 1) as last_model,
      NULL          as turn_count,
      NULL          as chain_id
    FROM events WHERE session_id = ? AND agent_id IS NULL
    HAVING COUNT(*) > 0

    UNION ALL

    SELECT
      a.id,
      a.agent_type,
      a.description,
      a.started_at,
      (SELECT COUNT(*) FROM events WHERE agent_id = a.id)                                    as event_count,
      (SELECT COALESCE(SUM(input_tokens + output_tokens), 0) FROM events WHERE agent_id = a.id) as total_tokens,
      (SELECT MAX(timestamp) FROM events WHERE agent_id = a.id)                              as last_active,
      (SELECT model FROM events WHERE agent_id = a.id AND model IS NOT NULL
       ORDER BY timestamp DESC LIMIT 1)                                                      as last_model,
      NULL          as turn_count,
      a.chain_id
    FROM agents a
    WHERE a.session_id = ?
      AND (SELECT COUNT(*) FROM events WHERE agent_id = a.id) > 0

    ORDER BY started_at ASC
  `).all(sessionId, sessionId, sessionId);
}
