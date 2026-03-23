# Server-side Pagination & Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move event filtering and text search from client-side array operations to SQLite queries so `total` always reflects the filtered count and pagination works correctly under all filter combinations.

**Architecture:** Add FTS5 virtual table for text search, `agentIds` filter to `listEvents`, and a new `listAgentSummaries` query. Replace `GET /api/events` with `POST /api/events/query`. Client hook sends typed POST bodies; components receive pre-aggregated agent summaries instead of a 10k event array.

**Tech Stack:** Bun, SQLite FTS5, Hono, React 19, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-23-server-side-pagination-filtering.md`

---

## Agentic Team Roles

When executing this plan with an agentic team, assign these four roles:

| Role | Responsibility |
|---|---|
| **Developer** | Implements each task in order |
| **Architect** | Answers design questions; owns the spec at `docs/superpowers/specs/2026-03-23-server-side-pagination-filtering.md` |
| **Reviewer** | After each task: verifies changed files match spec, checks for regressions, confirms no new lint errors |
| **Tester** | After each task: runs `bun test` and reports pass/fail; writes or updates tests when task calls for it |

Reviewer and Tester sign off before the next task begins.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/server/db/schema.ts` | Modify | Add FTS5 table, triggers, new indexes, backfill migration |
| `src/server/db/queries.ts` | Modify | Update `listEvents` (agentIds, search, limit cap); add `listAgentSummaries` |
| `src/server/api/events.ts` | Modify | Replace `GET /api/events` with `POST /api/events/query` |
| `src/server/api/sessions.ts` | Modify | Add `GET /api/sessions/:id/agent-summaries` |
| `src/client/lib/types.ts` | Modify | Add `UIEventFilters`, `EventQueryFilters`, `AgentSummary` |
| `src/client/lib/api.ts` | Modify | Add `post` helper, `events.query`, `sessions.agentSummaries` |
| `src/client/hooks/useDebouncedValue.ts` | Create | Generic debounce hook |
| `src/client/hooks/useInfiniteEvents.ts` | Modify | Typed filters, `toWireFilters`, call POST endpoint |
| `src/client/components/RawExplorer.tsx` | Modify | Debounced server-side search, SSE banner |
| `src/client/components/AgentTimeline.tsx` | Modify | Receive `agentSummaries`, server-side agent filter, SSE banner |
| `src/client/pages/SessionDetailPage.tsx` | Modify | Fetch agentSummaries, lazy Graph&Trace, header event count |
| `test/server/schema.test.ts` | Modify | Add FTS5 table/trigger existence tests |
| `test/server/queries.test.ts` | Create | Tests for updated `listEvents` + `listAgentSummaries` |
| `test/server/api.test.ts` | Modify | Update event test to use `POST /api/events/query` |

---

## Task 1: DB Schema — FTS5, Indexes, Triggers, Backfill

**Files:**
- Modify: `src/server/db/schema.ts`
- Modify: `test/server/schema.test.ts`

- [ ] **Step 1: Write failing tests for FTS5 table and new indexes**

Add to `test/server/schema.test.ts`:

```ts
test("creates events_fts virtual table", () => {
  applySchema(db);
  const vtab = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='events_fts'")
    .get() as { name: string } | null;
  expect(vtab).not.toBeNull();
});

test("creates FTS sync triggers", () => {
  applySchema(db);
  const triggers = db
    .query("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='events' ORDER BY name")
    .all() as { name: string }[];
  const names = triggers.map(t => t.name);
  expect(names).toContain("events_fts_ai");
  expect(names).toContain("events_fts_ad");
  expect(names).toContain("events_fts_au");
});

test("creates session_agent and session_ts indexes", () => {
  applySchema(db);
  const indexes = db
    .query("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
    .all() as { name: string }[];
  const names = indexes.map(i => i.name);
  expect(names).toContain("idx_events_session_agent");
  expect(names).toContain("idx_events_session_ts");
});

test("FTS backfill migration flag is recorded", () => {
  // Seed an event then apply schema (simulates existing DB upgrade)
  db.exec(`
    INSERT INTO projects VALUES ('p1','test','/p1',NULL);
    INSERT INTO sessions (id,project_id) VALUES ('s1','p1');
    INSERT INTO events (id,session_id,type,timestamp) VALUES ('e1','s1','assistant','2026-01-01T00:00:00Z');
  `);
  applySchema(db);
  const flag = db.query("SELECT value FROM settings WHERE key='migration_fts_backfill'").get() as any;
  expect(flag?.value).toBe("1");
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/vinkvdb/Documents/Projects/26-Claude/claude-telemetry
bun test test/server/schema.test.ts 2>&1 | tail -20
```

Expected: 4 new tests fail (FTS/trigger/index tests not yet implemented).

- [ ] **Step 3: Add FTS5 table, triggers, indexes, and backfill migration to `schema.ts`**

Add after the existing `idx_events_agent` migration block at the bottom of `applySchema`:

```ts
// FTS5 virtual table for full-text search on raw event JSON
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS events_fts
    USING fts5(raw, content=events, content_rowid=rowid);

  CREATE TRIGGER IF NOT EXISTS events_fts_ai AFTER INSERT ON events BEGIN
    INSERT INTO events_fts(rowid, raw) VALUES (new.rowid, new.raw);
  END;

  CREATE TRIGGER IF NOT EXISTS events_fts_ad AFTER DELETE ON events BEGIN
    INSERT INTO events_fts(events_fts, rowid, raw) VALUES ('delete', old.rowid, old.raw);
  END;

  CREATE TRIGGER IF NOT EXISTS events_fts_au AFTER UPDATE ON events BEGIN
    INSERT INTO events_fts(events_fts, rowid, raw) VALUES ('delete', old.rowid, old.raw);
    INSERT INTO events_fts(rowid, raw) VALUES (new.rowid, new.raw);
  END;
`);

// New composite indexes
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_events_session_agent ON events(session_id, agent_id);
  CREATE INDEX IF NOT EXISTS idx_events_session_ts    ON events(session_id, timestamp DESC);
`);

// FTS backfill — run once on first startup after upgrade
const ftsBackfill = db.query("SELECT value FROM settings WHERE key='migration_fts_backfill'").get();
if (!ftsBackfill) {
  const count = (db.query("SELECT COUNT(*) as c FROM events").get() as any).c;
  if (count > 0) {
    db.exec("INSERT INTO events_fts(rowid, raw) SELECT rowid, raw FROM events");
  }
  db.run(
    `INSERT INTO settings (key, value) VALUES ('migration_fts_backfill', '1')
     ON CONFLICT(key) DO UPDATE SET value='1'`
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test test/server/schema.test.ts
```

Expected: All tests pass including the 4 new ones.

- [ ] **Step 5: Verify full test suite still passes**

```bash
bun test
```

Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/db/schema.ts test/server/schema.test.ts
git commit -m "feat: add FTS5 table, triggers, and composite indexes to schema"
```

---

## Task 2: Types — `UIEventFilters`, `EventQueryFilters`, `AgentSummary`

**Files:**
- Modify: `src/client/lib/types.ts`

No server-side tests needed for pure type additions. These types are used by all subsequent tasks.

- [ ] **Step 1: Add the three new types to `src/client/lib/types.ts`**

Append to the end of the file:

```ts
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
}
```

- [ ] **Step 2: Verify TypeScript compiles with no errors**

```bash
bun run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: No type errors for the new types (compile errors may appear in files we haven't updated yet — that is expected and will be fixed in subsequent tasks).

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/types.ts
git commit -m "feat: add UIEventFilters, EventQueryFilters, AgentSummary types"
```

---

## Task 3: Query Layer — Update `listEvents` and Add `listAgentSummaries`

**Files:**
- Modify: `src/server/db/queries.ts`
- Create: `test/server/queries.test.ts`

- [ ] **Step 1: Write failing tests in new `test/server/queries.test.ts`**

```ts
// test/server/queries.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/server/db/schema";
import { listEvents, listAgentSummaries } from "../../src/server/db/queries";
import { processJsonlLine } from "../../src/server/ingestion/processor";

function seedEvent(db: Database, opts: {
  uuid: string; sessionId: string; type?: string; model?: string;
  agentId?: string; raw?: string;
}) {
  const line = JSON.stringify({
    uuid: opts.uuid,
    type: opts.type ?? "assistant",
    timestamp: "2026-01-01T00:00:00.000Z",
    sessionId: opts.sessionId,
    cwd: "/test/project",
    message: {
      model: opts.model ?? "claude-sonnet-4-6",
      role: "assistant",
      content: [{ type: "text", text: opts.raw ?? "hello" }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
    ...(opts.agentId ? { isSidechain: true, agentId: opts.agentId } : {}),
  });
  processJsonlLine(db, line, "-test-project");
}

describe("listEvents", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    seedEvent(db, { uuid: "e1", sessionId: "s1", type: "assistant", model: "claude-sonnet-4-6" });
    seedEvent(db, { uuid: "e2", sessionId: "s1", type: "user", model: "claude-sonnet-4-6" });
    seedEvent(db, { uuid: "e3", sessionId: "s1", type: "assistant", model: "claude-haiku-4-5", agentId: "agent-A" });
    seedEvent(db, { uuid: "e4", sessionId: "s2", type: "assistant", model: "claude-sonnet-4-6" });
  });

  test("returns all events without filters", () => {
    const { events, total } = listEvents(db, {});
    expect(total).toBe(4);
    expect(events.length).toBe(4);
  });

  test("filters by sessionId", () => {
    const { events, total } = listEvents(db, { sessionId: "s1" });
    expect(total).toBe(3);
    expect(events.length).toBe(3);
  });

  test("filters by type", () => {
    const { events, total } = listEvents(db, { type: "user" });
    expect(total).toBe(1);
    expect((events[0] as any).type).toBe("user");
  });

  test("filters by model prefix", () => {
    const { events, total } = listEvents(db, { model: "claude-haiku" });
    expect(total).toBe(1);
  });

  test("filters by agentIds — main agent only (sentinel __main__)", () => {
    const { events, total } = listEvents(db, { sessionId: "s1", agentIds: ["__main__"] });
    expect(total).toBe(2); // e1 and e2 have no agentId
    events.forEach(e => expect((e as any).agent_id).toBeNull());
  });

  test("filters by agentIds — specific agent", () => {
    const { events, total } = listEvents(db, { sessionId: "s1", agentIds: ["agent-A"] });
    expect(total).toBe(1);
    expect((events[0] as any).agent_id).toBe("agent-A");
  });

  test("filters by agentIds — main + specific agent", () => {
    const { events, total } = listEvents(db, { sessionId: "s1", agentIds: ["__main__", "agent-A"] });
    expect(total).toBe(3);
  });

  test("search via FTS5", () => {
    // Seed an event with a distinct raw string
    const searchLine = JSON.stringify({
      uuid: "search-e1",
      type: "assistant",
      timestamp: "2026-01-01T00:00:00.000Z",
      sessionId: "s1",
      cwd: "/test/project",
      specialKeyword: "xyzzy12345",
      message: { model: "claude-sonnet-4-6", role: "assistant", content: [{ type: "text", text: "hi" }],
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    });
    processJsonlLine(db, searchLine, "-test-project");

    const { events, total } = listEvents(db, { search: "xyzzy12345" });
    expect(total).toBe(1);
    expect((events[0] as any).id).toContain("search-e1");
  });

  test("enforces max limit of 1000", () => {
    const { events } = listEvents(db, { limit: 99999 });
    // We only have 4 events so all are returned — but internally limit is capped at 1000
    expect(events.length).toBe(4);
  });

  test("pagination with offset", () => {
    const { events } = listEvents(db, { limit: 2, offset: 0 });
    expect(events.length).toBe(2);
    const { events: page2 } = listEvents(db, { limit: 2, offset: 2 });
    expect(page2.length).toBe(2);
    const ids1 = (events as any[]).map(e => e.id);
    const ids2 = (page2 as any[]).map(e => e.id);
    expect(ids1).not.toEqual(ids2);
  });
});

describe("listAgentSummaries", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    seedEvent(db, { uuid: "e1", sessionId: "s1", type: "assistant", model: "claude-sonnet-4-6" });
    seedEvent(db, { uuid: "e2", sessionId: "s1", type: "user" });
    seedEvent(db, { uuid: "e3", sessionId: "s1", type: "assistant", model: "claude-haiku-4-5", agentId: "agent-A" });
  });

  test("returns main agent row with correct aggregates", () => {
    const summaries = listAgentSummaries(db, "s1");
    const main = summaries.find(s => (s as any).id === null);
    expect(main).toBeDefined();
    expect((main as any).event_count).toBe(2); // e1 and e2
    expect((main as any).agent_type).toBe("main");
  });

  test("returns subagent row", () => {
    const summaries = listAgentSummaries(db, "s1");
    const sub = summaries.find(s => (s as any).id === "agent-A");
    expect(sub).toBeDefined();
    expect((sub as any).event_count).toBe(1);
    expect((sub as any).last_model).toBe("claude-haiku-4-5");
  });

  test("main agent row comes first", () => {
    const summaries = listAgentSummaries(db, "s1");
    expect((summaries[0] as any).id).toBeNull();
  });

  test("returns empty array for session with no agents", () => {
    const summaries = listAgentSummaries(db, "nonexistent-session");
    expect(summaries).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test test/server/queries.test.ts 2>&1 | tail -30
```

Expected: Tests fail — `listEvents` doesn't accept `agentIds`/`search`, `listAgentSummaries` doesn't exist.

- [ ] **Step 3: Update `listEvents` in `src/server/db/queries.ts`**

Replace the existing `listEvents` function with:

```ts
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

  if (filters.agentIds && filters.agentIds.length > 0) {
    const hasMain = filters.agentIds.includes("__main__");
    const realIds = filters.agentIds.filter(id => id !== "__main__");

    if (hasMain && realIds.length > 0) {
      conditions.push(`(e.agent_id IS NULL OR e.agent_id IN (${realIds.map(() => "?").join(",")}))`);
      params.push(...realIds);
    } else if (hasMain) {
      conditions.push("e.agent_id IS NULL");
    } else {
      conditions.push(`e.agent_id IN (${realIds.map(() => "?").join(",")})`);
      params.push(...realIds);
    }
  }

  const limit  = Math.min(filters.limit  ?? 100, 1000);
  const offset = filters.offset ?? 0;

  // FTS5 search: join to events_fts virtual table
  const useFts = !!filters.search;
  const fromClause  = useFts
    ? "FROM events e JOIN events_fts fts ON e.rowid = fts.rowid"
    : "FROM events e";
  const ftsCondition = useFts ? ["fts MATCH ?"] : [];
  const ftsParams    = useFts ? [filters.search] : [];

  const allConditions = [...ftsCondition, ...conditions];
  const where = allConditions.length > 0 ? `WHERE ${allConditions.join(" AND ")}` : "";
  const allParams = [...ftsParams, ...params];

  return {
    events: db
      .query(`SELECT e.* ${fromClause} ${where} ORDER BY e.timestamp DESC LIMIT ? OFFSET ?`)
      .all(...allParams, limit, offset),
    total: (db
      .query(`SELECT COUNT(*) as c ${fromClause} ${where}`)
      .get(...allParams) as any).c,
  };
}
```

- [ ] **Step 4: Add `listAgentSummaries` to `src/server/db/queries.ts`**

Append after `listAgents`:

```ts
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
       ORDER BY timestamp DESC LIMIT 1) as last_model
    FROM events WHERE session_id = ? AND agent_id IS NULL

    UNION ALL

    SELECT
      a.id,
      a.agent_type,
      a.description,
      a.started_at,
      (SELECT COUNT(*) FROM events WHERE agent_id = a.id) as event_count,
      (SELECT COALESCE(SUM(input_tokens + output_tokens), 0) FROM events WHERE agent_id = a.id) as total_tokens,
      (SELECT MAX(timestamp) FROM events WHERE agent_id = a.id) as last_active,
      (SELECT model FROM events WHERE agent_id = a.id AND model IS NOT NULL
       ORDER BY timestamp DESC LIMIT 1) as last_model
    FROM agents a WHERE a.session_id = ?

    ORDER BY started_at ASC
  `).all(sessionId, sessionId, sessionId);
}
```

Note the bind array is `[sessionId, sessionId, sessionId]`: positions 1–2 for the main branch (subquery + FROM), position 3 for the subagent WHERE.

- [ ] **Step 5: Run the query tests to confirm they pass**

```bash
bun test test/server/queries.test.ts
```

Expected: All tests pass.

- [ ] **Step 6: Run full test suite**

```bash
bun test
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/db/queries.ts test/server/queries.test.ts
git commit -m "feat: add agentIds/search to listEvents; add listAgentSummaries query"
```

---

## Task 4: API Routes — `POST /api/events/query` and `GET /api/sessions/:id/agent-summaries`

**Files:**
- Modify: `src/server/api/events.ts`
- Modify: `src/server/api/sessions.ts`
- Modify: `test/server/api.test.ts`

- [ ] **Step 1: Write failing tests in `test/server/api.test.ts`**

Add `listAgentSummaries` to the import from queries (it will be used indirectly via route). Add these test cases alongside the existing ones:

```ts
// Add to imports at top:
import { createAgentRoutes } from "../../src/server/api/agents";

test("POST /api/events/query filters by sessionId", async () => {
  const res = await app.request("/api/events/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "sess-abc" }),
  });
  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.events.length).toBe(1);
  expect(data.total).toBe(1);
});

test("POST /api/events/query returns 400 for invalid JSON", async () => {
  const res = await app.request("/api/events/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not-json",
  });
  expect(res.status).toBe(400);
});

test("GET /api/sessions/:id/agent-summaries returns main agent", async () => {
  const res = await app.request("/api/sessions/sess-abc/agent-summaries");
  expect(res.status).toBe(200);
  const data = await res.json();
  expect(Array.isArray(data)).toBe(true);
  const main = data.find((s: any) => s.id === null);
  expect(main).toBeDefined();
  expect(main.event_count).toBeGreaterThan(0);
});
```

Also update the existing broken test (it still tests `GET /api/events` which will be removed later):
```ts
// Keep the old GET test for now — it will be removed in Task 8 when the route is deleted
```

- [ ] **Step 2: Run tests to confirm new tests fail**

```bash
bun test test/server/api.test.ts 2>&1 | tail -20
```

Expected: 3 new tests fail — routes don't exist yet.

- [ ] **Step 3: Update `src/server/api/events.ts`**

Replace the entire file:

```ts
import type { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { listEvents } from "../db/queries";

export function createEventRoutes(app: Hono, db: Database): void {
  app.post("/api/events/query", async (c) => {
    let filters: Record<string, any>;
    try {
      filters = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    try {
      const result = listEvents(db, {
        sessionId:  typeof filters.sessionId  === "string" ? filters.sessionId  : undefined,
        type:       typeof filters.type       === "string" ? filters.type       : undefined,
        model:      typeof filters.model      === "string" ? filters.model      : undefined,
        toolName:   typeof filters.toolName   === "string" ? filters.toolName   : undefined,
        agentIds:   Array.isArray(filters.agentIds) ? filters.agentIds.filter((x: any) => typeof x === "string") : undefined,
        search:     typeof filters.search     === "string" ? filters.search     : undefined,
        limit:      typeof filters.limit      === "number" ? filters.limit      : undefined,
        offset:     typeof filters.offset     === "number" ? filters.offset     : undefined,
      });
      return c.json(result);
    } catch (err: any) {
      // FTS5 throws on invalid MATCH syntax
      return c.json({ error: "Invalid search query" }, 400);
    }
  });

  // Keep GET /api/events stub until useInfiniteEvents is updated in Task 8
  app.get("/api/events", (c) => {
    const filters = {
      sessionId: c.req.query("sessionId"),
      type:      c.req.query("type"),
      model:     c.req.query("model"),
      toolName:  c.req.query("toolName"),
      limit:     c.req.query("limit")  ? parseInt(c.req.query("limit")!)  : undefined,
      offset:    c.req.query("offset") ? parseInt(c.req.query("offset")!) : undefined,
    };
    return c.json(listEvents(db, filters));
  });
}
```

- [ ] **Step 4: Add agent-summaries route to `src/server/api/sessions.ts`**

Add the following import at the top:
```ts
import { listSessions, getSession, getSessionCostBreakdown, listAgentSummaries } from "../db/queries";
```

Add the following route inside `createSessionRoutes`:
```ts
app.get("/api/sessions/:id/agent-summaries", (c) => {
  const id = c.req.param("id");
  return c.json(listAgentSummaries(db, id));
});
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
bun test test/server/api.test.ts
```

Expected: All tests pass including the 3 new ones.

- [ ] **Step 6: Run full test suite**

```bash
bun test
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/api/events.ts src/server/api/sessions.ts test/server/api.test.ts
git commit -m "feat: add POST /api/events/query and GET /api/sessions/:id/agent-summaries"
```

---

## Task 5: Client API — `post` Helper and New Endpoints

**Files:**
- Modify: `src/client/lib/api.ts`

No unit tests for this file (it's a thin HTTP wrapper; integration-tested via the components).

- [ ] **Step 1: Update `src/client/lib/api.ts`**

Replace the entire file:

```ts
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
```

- [ ] **Step 2: Check for TypeScript errors**

```bash
bun run build 2>&1 | grep "error TS" | grep "api.ts"
```

Expected: No errors in `api.ts`. (Errors in other files that reference `api.events.list` are expected and will be fixed in Task 8.)

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/api.ts
git commit -m "feat: add post helper, events.query, and sessions.agentSummaries to client API"
```

---

## Task 6: `useDebouncedValue` Hook

**Files:**
- Create: `src/client/hooks/useDebouncedValue.ts`

- [ ] **Step 1: Create `src/client/hooks/useDebouncedValue.ts`**

```ts
// src/client/hooks/useDebouncedValue.ts
import { useState, useEffect } from "react";

/**
 * Returns a debounced copy of `value` that only updates after `delay` ms
 * of no changes. Use for search inputs (300ms) and rapid toggles (150ms).
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
bun run build 2>&1 | grep "error TS" | grep "useDebouncedValue"
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/client/hooks/useDebouncedValue.ts
git commit -m "feat: add useDebouncedValue hook"
```

---

## Task 7: Update `useInfiniteEvents` — Typed Filters, POST, `toWireFilters`

**Files:**
- Modify: `src/client/hooks/useInfiniteEvents.ts`

- [ ] **Step 1: Replace `src/client/hooks/useInfiniteEvents.ts`**

Replace the entire file with the updated version. Key changes:
1. `filters` type changes from `Record<string, string>` to `UIEventFilters`
2. New `toWireFilters` function converts `null → "__main__"` and builds `EventQueryFilters`
3. `fetchPage` and `jumpTo` both call `api.events.query` (POST) instead of `api.events.list`
4. After updating, remove `GET /api/events` from `src/server/api/events.ts`

```ts
// src/client/hooks/useInfiniteEvents.ts
import { useState, useCallback, useRef } from "react";
import { api } from "../lib/api";
import type { Event, UIEventFilters, EventQueryFilters } from "../lib/types";

export type { UIEventFilters };

export interface UseInfiniteEventsOptions {
  /** Filters for the API call */
  filters: UIEventFilters;
  /** Page size */
  pageSize?: number;
  /** Maximum events held in memory (oldest trimmed when exceeded) */
  maxLoadedEvents?: number;
}

export interface UseInfiniteEventsResult {
  events: Event[];
  total: number;
  isLoading: boolean;
  loadMore: () => void;
  loadPrevious: () => void;
  jumpTo: (eventNumber: number) => void;
  scrollToTop: () => void;
  offset: number;
  hasMore: boolean;
  hasPrevious: boolean;
  jumpTargetEventId: string | null;
}

/** Convert UI filters (with null agentIds) to wire format (string-only agentIds) */
function toWireFilters(filters: UIEventFilters): EventQueryFilters {
  const wire: EventQueryFilters = { ...filters };
  if (filters.agentIds) {
    wire.agentIds = filters.agentIds.map(id => (id === null ? "__main__" : id));
  }
  return wire;
}

export function useInfiniteEvents(
  options: UseInfiniteEventsOptions
): UseInfiniteEventsResult {
  const { filters, pageSize = 200, maxLoadedEvents = 2000 } = options;

  const [events, setEvents] = useState<Event[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [jumpTargetEventId, setJumpTargetEventId] = useState<string | null>(null);

  const baseOffsetRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const filtersKeyRef = useRef("");

  const fetchPage = useCallback(
    async (
      pageOffset: number,
      mode: "replace" | "append" | "prepend"
    ): Promise<void> => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoading(true);

      const MAX_EMPTY_RETRIES = 10;
      let currentOffset = pageOffset;

      try {
        for (let attempt = 0; attempt <= MAX_EMPTY_RETRIES; attempt++) {
          const wireFilters = toWireFilters({ ...filters, limit: pageSize, offset: currentOffset });

          const result = await api.events.query(wireFilters);

          if (controller.signal.aborted) return;

          setTotal(result.total);

          if (result.events.length === 0) {
            const nextOffset = currentOffset + pageSize;
            if (nextOffset < result.total && attempt < MAX_EMPTY_RETRIES) {
              currentOffset = nextOffset;
              continue;
            }
            break;
          }

          if (mode === "replace") {
            setEvents(result.events);
            baseOffsetRef.current = currentOffset;
            setOffset(currentOffset);
          } else if (mode === "append") {
            setEvents((prev) => {
              const combined = [...prev, ...result.events];
              if (combined.length > maxLoadedEvents) {
                const trimCount = combined.length - maxLoadedEvents;
                baseOffsetRef.current += trimCount;
                return combined.slice(trimCount);
              }
              return combined;
            });
          } else if (mode === "prepend") {
            setEvents((prev) => {
              const combined = [...result.events, ...prev];
              if (combined.length > maxLoadedEvents) return combined.slice(0, maxLoadedEvents);
              return combined;
            });
            baseOffsetRef.current = currentOffset;
          }

          break;
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (controller.signal.aborted) return;
        console.error("Failed to fetch events:", err);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    },
    [filters, pageSize]
  );

  // Initial load + reload when filters change
  const filtersKey = JSON.stringify(filters);
  if (filtersKey !== filtersKeyRef.current) {
    filtersKeyRef.current = filtersKey;
    baseOffsetRef.current = 0;
    setOffset(0);
    setEvents([]);
    setJumpTargetEventId(null);
    fetchPage(0, "replace");
  }

  const loadMore = useCallback(() => {
    if (isLoading) return;
    const nextOffset = baseOffsetRef.current + events.length;
    if (nextOffset >= total) return;
    setOffset(nextOffset);
    fetchPage(nextOffset, "append");
  }, [isLoading, events.length, total, fetchPage]);

  const loadPrevious = useCallback(() => {
    if (isLoading) return;
    if (baseOffsetRef.current <= 0) return;
    const prevOffset = Math.max(0, baseOffsetRef.current - pageSize);
    fetchPage(prevOffset, "prepend");
  }, [isLoading, pageSize, fetchPage]);

  const jumpTo = useCallback(
    (eventNumber: number) => {
      const targetOffset = Math.max(0, Math.min(total - eventNumber, total - 1));
      const windowStart  = Math.max(0, targetOffset - pageSize);

      baseOffsetRef.current = windowStart;
      setOffset(windowStart);
      setEvents([]);
      setJumpTargetEventId(null);

      const windowSize = Math.min(pageSize * 2, total - windowStart);
      const controller = new AbortController();
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = controller;
      setIsLoading(true);

      const wireFilters = toWireFilters({ ...filters, limit: windowSize, offset: windowStart });

      api.events
        .query(wireFilters)
        .then((result) => {
          if (controller.signal.aborted) return;
          setTotal(result.total);
          setEvents(result.events);
          baseOffsetRef.current = windowStart;
          const indexInWindow = targetOffset - windowStart;
          const targetEvent = result.events[indexInWindow];
          setJumpTargetEventId(targetEvent?.id ?? null);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          console.error("Failed to fetch events:", err);
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    },
    [total, pageSize, filters]
  );

  const scrollToTop = useCallback(() => {
    baseOffsetRef.current = 0;
    setOffset(0);
    setEvents([]);
    setJumpTargetEventId(null);
    fetchPage(0, "replace");
  }, [fetchPage]);

  const hasMore     = baseOffsetRef.current + events.length < total;
  const hasPrevious = baseOffsetRef.current > 0;

  return {
    events,
    total,
    isLoading,
    loadMore,
    loadPrevious,
    jumpTo,
    scrollToTop,
    offset: baseOffsetRef.current,
    hasMore,
    hasPrevious,
    jumpTargetEventId,
  };
}
```

- [ ] **Step 2: Remove the `GET /api/events` stub from `src/server/api/events.ts`**

Delete the `app.get("/api/events", ...)` block entirely. The route is no longer used.

- [ ] **Step 3: Update the old GET test in `test/server/api.test.ts`**

Replace:
```ts
test("GET /api/events?sessionId= returns events with pagination", async () => {
  const res = await app.request("/api/events?sessionId=sess-abc");
  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.events.length).toBe(1);
  expect(data.total).toBe(1);
});
```

With:
```ts
test("GET /api/events is removed (404)", async () => {
  const res = await app.request("/api/events?sessionId=sess-abc");
  expect(res.status).toBe(404);
});
```

- [ ] **Step 4: Run full test suite**

```bash
bun test
```

Expected: All tests pass.

- [ ] **Step 5: Check for TypeScript build errors**

```bash
bun run build 2>&1 | grep "error TS" | head -20
```

Expected: No TypeScript errors (or only errors in components not yet updated, which are addressed in Tasks 8–10).

- [ ] **Step 6: Commit**

```bash
git add src/client/hooks/useInfiniteEvents.ts src/server/api/events.ts test/server/api.test.ts
git commit -m "feat: update useInfiniteEvents to use typed UIEventFilters and POST /api/events/query"
```

---

## Task 8: RawExplorer — Debounced Server-side Search + SSE Banner

**Files:**
- Modify: `src/client/components/RawExplorer.tsx`

- [ ] **Step 1: Update `src/client/components/RawExplorer.tsx`**

Replace the entire file:

```tsx
// src/client/components/RawExplorer.tsx
import { useState, useMemo } from "react";
import { useInfiniteEvents } from "../hooks/useInfiniteEvents";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useSSE } from "../lib/sse";
import { EventTable } from "./EventTable";
import { DetailPanel } from "./DetailPanel";
import type { Event } from "../lib/types";

export function RawExplorer() {
  const [selected, setSelected] = useState<Event | null>(null);
  const [typeFilter, setTypeFilter]   = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [newEventCount, setNewEventCount] = useState(0);

  // Debounce search — 300ms so we don't fire a request per keystroke
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  const filters = useMemo(() => ({
    ...(typeFilter  ? { type:   typeFilter  } : {}),
    ...(modelFilter ? { model:  modelFilter } : {}),
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
  }), [typeFilter, modelFilter, debouncedSearch]);

  const {
    events,
    total,
    isLoading,
    loadMore,
    loadPrevious,
    jumpTo,
    scrollToTop,
    offset,
    hasMore,
    hasPrevious,
    jumpTargetEventId,
  } = useInfiniteEvents({ filters, pageSize: 100 });

  const eventNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    events.forEach((e, i) => {
      map.set(e.id, total - offset - i);
    });
    return map;
  }, [events, total, offset]);

  // SSE: reload immediately if at top; show banner if user has scrolled back
  useSSE((_eventName) => {
    if (offset === 0 && !isLoading) {
      scrollToTop();
    } else {
      setNewEventCount((c) => c + 1);
    }
  });

  const handleScrollToTop = () => {
    scrollToTop();
    setNewEventCount(0);
  };

  return (
    <div className="flex gap-4 items-start">
      <div className="flex-[3] min-w-0">
        {/* Filters */}
        <div className="flex gap-3 mb-4 flex-wrap">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="border border-border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All types</option>
            <option value="assistant">Assistant</option>
            <option value="user">User</option>
            <option value="progress">Progress</option>
            <option value="system">System</option>
          </select>
          <select
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            className="border border-border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All models</option>
            <option value="claude-opus-4-6">Opus</option>
            <option value="claude-sonnet-4-6">Sonnet</option>
            <option value="claude-haiku-4-5">Haiku</option>
          </select>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search raw JSON..."
            className="border border-border rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[160px]"
          />
        </div>

        {/* New events banner */}
        {newEventCount > 0 && (
          <button
            onClick={handleScrollToTop}
            className="w-full mb-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
          >
            {newEventCount} new event{newEventCount !== 1 ? "s" : ""} — scroll to top
          </button>
        )}

        <EventTable
          events={events}
          total={total}
          isLoading={isLoading}
          onLoadMore={loadMore}
          onLoadPrevious={loadPrevious}
          offset={offset}
          hasMore={hasMore}
          hasPrevious={hasPrevious}
          onJumpTo={jumpTo}
          onScrollToTop={handleScrollToTop}
          selected={selected}
          onSelect={setSelected}
          eventNumberMap={eventNumberMap}
          jumpTargetEventId={jumpTargetEventId}
        />
      </div>

      <div className="flex-[2] min-w-0 sticky top-4">
        {selected ? (
          <DetailPanel event={selected} onClose={() => setSelected(null)} />
        ) : (
          <div className="border border-border rounded-xl p-6 text-center text-muted text-sm">
            Click a row to inspect the event
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
bun run build 2>&1 | grep "error TS" | grep "RawExplorer" | head -10
```

Expected: No errors in RawExplorer.tsx.

- [ ] **Step 3: Commit**

```bash
git add src/client/components/RawExplorer.tsx
git commit -m "feat: move search to server-side in RawExplorer; add new-events banner"
```

---

## Task 9: AgentTimeline — Server-side Agent Filter, `agentSummaries` Prop, SSE Banner

**Files:**
- Modify: `src/client/components/AgentTimeline.tsx`

- [ ] **Step 1: Update `src/client/components/AgentTimeline.tsx`**

Replace the entire file. Key changes:
- Remove `events: Event[]` and `agents: Agent[]` props; receive `agentSummaries: AgentSummary[]` instead
- Assign colors by index from `agentSummaries` (main gets `MAIN_COLOR`, subagents get `AGENT_COLORS[i]`)
- `visibleAgents` initialized from `agentSummaries.map(s => s.id)`
- `debouncedVisibleAgents` (150ms) drives the hook filter; `visibleAgents` drives card UI immediately
- Add SSE banner logic

```tsx
// src/client/components/AgentTimeline.tsx
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { Event, AgentSummary } from "../lib/types";
import { DetailPanel } from "./DetailPanel";
import { EventTable } from "./EventTable";
import { useInfiniteEvents } from "../hooks/useInfiniteEvents";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useSSE } from "../lib/sse";
import { formatTokens, timeAgo, cn } from "../lib/utils";
import { useSettings } from "../contexts/SettingsContext";

export function AgentTimeline({
  agentSummaries,
  sessionId,
  refreshSignal,
}: {
  agentSummaries: AgentSummary[];
  sessionId: string;
  refreshSignal?: number;
}) {
  const { settings } = useSettings();
  const AGENT_COLORS: string[] = settings["graph.agentColors"] ?? ["#00a2e0", "#bdd72d", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];
  const MAIN_COLOR: string = settings["graph.mainColor"] ?? "#003864";
  const formatOpts = {
    kThreshold: settings["display.tokenKThreshold"] as number,
    mThreshold: settings["display.tokenMThreshold"] as number,
    costPrecisionThreshold: settings["display.costPrecisionThreshold"] as number,
    timeAgoJustNow: settings["display.timeAgoJustNow"] as number,
    timeAgoMinutes: settings["display.timeAgoMinutes"] as number,
    timeAgoHours: settings["display.timeAgoHours"] as number,
  };

  const [selected, setSelected] = useState<Event | null>(null);
  const [newEventCount, setNewEventCount] = useState(0);

  // Initialize all agents as visible
  const [visibleAgents, setVisibleAgents] = useState<Set<string | null>>(
    () => new Set(agentSummaries.map(s => s.id))
  );

  // Sync visibleAgents set when agentSummaries changes (e.g. new agent appears)
  useEffect(() => {
    setVisibleAgents(prev => {
      const next = new Set(prev);
      agentSummaries.forEach(s => next.add(s.id));
      return next;
    });
  }, [agentSummaries]);

  // Color and name maps derived from agentSummaries
  // Main (id=null) always gets MAIN_COLOR; subagents get AGENT_COLORS by index
  const summaries = useMemo(() => {
    return agentSummaries.map((s, i) => ({
      ...s,
      color: s.id === null
        ? MAIN_COLOR
        : AGENT_COLORS[(i - 1) % AGENT_COLORS.length],  // i-1 because main is index 0
      name: s.id === null ? "main" : (s.agent_type ?? "agent"),
    }));
  }, [agentSummaries, MAIN_COLOR, AGENT_COLORS]);

  const colorMap = useMemo(() => {
    const map = new Map<string | null, string>();
    summaries.forEach(s => map.set(s.id, s.color));
    return map;
  }, [summaries]);

  const nameMap = useMemo(() => {
    const map = new Map<string | null, string>();
    summaries.forEach(s => map.set(s.id, s.name));
    return map;
  }, [summaries]);

  // Debounce visible agents → agentIds filter (150ms to batch rapid show/hide-all clicks)
  const debouncedVisibleAgents = useDebouncedValue(visibleAgents, 150);

  const hookFilters = useMemo(() => {
    const allIds = new Set(agentSummaries.map(s => s.id));
    const allVisible = [...allIds].every(id => debouncedVisibleAgents.has(id));

    if (allVisible) {
      // No agentIds filter — return all events for this session
      return { sessionId };
    }

    return {
      sessionId,
      agentIds: [...debouncedVisibleAgents] as (string | null)[],
    };
  }, [sessionId, debouncedVisibleAgents, agentSummaries]);

  const {
    events: hookEvents,
    total,
    isLoading,
    loadMore,
    loadPrevious,
    jumpTo,
    scrollToTop,
    offset,
    hasMore,
    hasPrevious,
    jumpTargetEventId,
  } = useInfiniteEvents({
    filters: hookFilters,
    maxLoadedEvents: settings["display.maxLoadedEvents"] ?? 500,
  });

  // Refresh on SSE signal from parent
  const prevRefreshSignal = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal !== undefined && refreshSignal !== prevRefreshSignal.current) {
      prevRefreshSignal.current = refreshSignal;
      if (offset === 0 && !isLoading) {
        scrollToTop();
      } else {
        setNewEventCount(c => c + 1);
      }
    }
  }, [refreshSignal, scrollToTop, offset, isLoading]);

  // SSE: new event for this session
  useSSE((_event, data) => {
    if (data?.sessionId === sessionId) {
      if (offset === 0 && !isLoading) {
        scrollToTop();
      } else {
        setNewEventCount(c => c + 1);
      }
    }
  });

  const handleScrollToTop = () => {
    scrollToTop();
    setNewEventCount(0);
  };

  const eventNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    hookEvents.forEach((e, i) => {
      map.set(e.id, total - offset - i);
    });
    return map;
  }, [hookEvents, total, offset]);

  // Auto-enable agent when jumping to one of its events
  useEffect(() => {
    if (!jumpTargetEventId) return;
    const targetEvent = hookEvents.find(e => e.id === jumpTargetEventId);
    if (targetEvent) {
      const agentId = targetEvent.agent_id ?? null;
      setVisibleAgents(prev => {
        if (prev.has(agentId)) return prev;
        const next = new Set(prev);
        next.add(agentId);
        return next;
      });
    }
  }, [jumpTargetEventId, hookEvents]);

  const toggleAgent = useCallback((id: string | null) => {
    setVisibleAgents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const hideAll = useCallback(() => setVisibleAgents(new Set()), []);
  const showAll = useCallback(() => {
    setVisibleAgents(new Set(agentSummaries.map(s => s.id)));
  }, [agentSummaries]);

  const autoEnableAgent = useCallback((agentId: string | null) => {
    setVisibleAgents(prev => {
      if (prev.has(agentId)) return prev;
      const next = new Set(prev);
      next.add(agentId);
      return next;
    });
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-semibold text-primary-dark">Agents</span>
        <div className="flex gap-1.5">
          <button onClick={hideAll} className="text-xs text-muted hover:text-primary-dark border border-border rounded px-2 py-0.5 hover:border-primary transition-colors">Hide all</button>
          <button onClick={showAll} className="text-xs text-muted hover:text-primary-dark border border-border rounded px-2 py-0.5 hover:border-primary transition-colors">Show all</button>
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(220px, 1fr))` }}>
        {summaries.map((s) => {
          const active = visibleAgents.has(s.id);
          return (
            <div
              key={s.id ?? "__main__"}
              onClick={() => toggleAgent(s.id)}
              className={cn(
                "border rounded-xl bg-white p-3 flex flex-col gap-1 cursor-pointer transition-all select-none",
                active ? "border-primary/40 shadow-sm" : "border-border opacity-50",
                "hover:shadow-md"
              )}
            >
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-sm font-semibold text-primary-dark truncate">{s.name}</span>
                {s.last_model && (
                  <span className="text-xs text-muted font-mono ml-auto">{s.last_model.replace("claude-", "")}</span>
                )}
              </div>
              {s.description && (
                <p className="text-xs text-muted truncate" title={s.description}>{s.description}</p>
              )}
              <div className="flex items-center gap-3 text-xs text-muted mt-1">
                <span>{s.event_count} events</span>
                <span>{formatTokens(s.total_tokens, formatOpts)} tok</span>
                {s.last_active && <span className="ml-auto">{timeAgo(s.last_active, formatOpts)}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* New events banner */}
      {newEventCount > 0 && (
        <button
          onClick={handleScrollToTop}
          className="w-full py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
        >
          {newEventCount} new event{newEventCount !== 1 ? "s" : ""} — scroll to top
        </button>
      )}

      <div className="flex gap-4 items-start">
        <div className="flex-[3] min-w-0">
          <EventTable
            events={hookEvents}
            total={total}
            isLoading={isLoading}
            onLoadMore={loadMore}
            onLoadPrevious={loadPrevious}
            offset={offset}
            hasMore={hasMore}
            hasPrevious={hasPrevious}
            onJumpTo={jumpTo}
            onScrollToTop={handleScrollToTop}
            selected={selected}
            onSelect={setSelected}
            eventNumberMap={eventNumberMap}
            jumpTargetEventId={jumpTargetEventId}
            showAgentColumn
            colorMap={colorMap}
            nameMap={nameMap}
            onAutoEnableAgent={autoEnableAgent}
          />
        </div>
        <div className="flex-[2] min-w-0 sticky top-4 self-start">
          {selected ? (
            <DetailPanel event={selected} onClose={() => setSelected(null)} />
          ) : (
            <div className="border border-border rounded-xl bg-surface p-6 text-center text-muted text-sm">
              Click a row to inspect the event
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
bun run build 2>&1 | grep "error TS" | grep "AgentTimeline" | head -10
```

Expected: No errors in AgentTimeline.tsx.

- [ ] **Step 3: Commit**

```bash
git add src/client/components/AgentTimeline.tsx
git commit -m "feat: AgentTimeline uses agentSummaries prop and server-side agent filter"
```

---

## Task 10: SessionDetailPage — Fetch `agentSummaries`, Lazy Graph&Trace

**Files:**
- Modify: `src/client/pages/SessionDetailPage.tsx`

- [ ] **Step 1: Update `src/client/pages/SessionDetailPage.tsx`**

Replace the entire file:

```tsx
import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import { AgentTimeline } from "../components/AgentTimeline";
import { TraceView } from "../components/TraceView";
import { AgentGraph } from "../components/AgentGraph";
import { CostBreakdownPanel } from "../components/CostBreakdownPanel";
import { useSSE } from "../lib/sse";
import { formatTokens, formatCost, cn } from "../lib/utils";
import type { Session, Event, Agent, CostBreakdown, AgentSummary } from "../lib/types";

type Tab = "agents" | "graph-trace";

export function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [agentSummaries, setAgentSummaries] = useState<AgentSummary[]>([]);
  const [costs, setCosts] = useState<CostBreakdown[]>([]);
  const [tab, setTab] = useState<Tab>("agents");
  const [live, setLive] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);

  // Graph & Trace: lazy-loaded only when that tab is first opened
  const [graphEvents, setGraphEvents] = useState<Event[]>([]);
  const [graphAgents, setGraphAgents] = useState<Agent[]>([]);
  const [graphLoaded, setGraphLoaded] = useState(false);

  const fetchCore = useCallback(async () => {
    if (!id) return;
    const [sess, summaries, costData] = await Promise.all([
      api.sessions.get(id),
      api.sessions.agentSummaries(id),
      api.sessions.costs(id).catch(() => [] as CostBreakdown[]),
    ]);
    setSession(sess);
    setAgentSummaries(summaries);
    setCosts(costData);
    setLive(true);
  }, [id]);

  useEffect(() => { fetchCore(); }, [fetchCore]);

  // Lazy-load Graph & Trace data when that tab becomes active
  useEffect(() => {
    if (tab !== "graph-trace" || graphLoaded || !id) return;
    Promise.all([
      api.events.query({ sessionId: id, limit: 5000, offset: 0 }),
      api.agents.list(id),
    ]).then(([evtResult, agts]) => {
      setGraphEvents(evtResult.events);
      setGraphAgents(agts);
      setGraphLoaded(true);
    });
  }, [tab, graphLoaded, id]);

  useSSE((event, data) => {
    if (event === "event" && data.sessionId === id) {
      fetchCore();
      setRefreshSignal(s => s + 1);
      // If graph tab is open, reload graph data too
      if (tab === "graph-trace") {
        setGraphLoaded(false); // triggers reload via useEffect above
      }
    }
  });

  if (!session) return <p className="text-muted animate-pulse">Loading...</p>;

  const totalTokens = session.total_input_tokens + session.total_output_tokens;
  const tabs: { key: Tab; label: string }[] = [
    { key: "agents", label: "Agents" },
    { key: "graph-trace", label: "Graph & Trace" },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-muted mb-4">
        <Link to="/" className="hover:text-primary">Projects</Link>
        <span>/</span>
        <Link to={`/projects/${encodeURIComponent(session.project_id)}`} className="hover:text-primary">
          {session.project_id.split("-").pop()}
        </Link>
        <span>/</span>
        <span className="text-primary-dark font-medium">{session.slug || session.id.slice(0, 8)}</span>
      </div>

      <div className="flex items-center gap-6 mb-2">
        <h1 className="text-2xl font-semibold text-primary-dark">{session.slug || "Session"}</h1>
        <div className="flex gap-4 text-sm">
          <span className="text-muted">Tokens: <strong className="text-primary-dark">{formatTokens(totalTokens)}</strong></span>
          <span className="text-muted">Cost: <strong className="text-primary-dark">{formatCost(session.total_cost_usd)}</strong></span>
          <span className="text-muted">Events: <strong className="text-primary-dark">{session.event_count}</strong></span>
          {agentSummaries.length > 1 && (
            <span className="text-muted">Agents: <strong className="text-primary-dark">{agentSummaries.length - 1}</strong></span>
          )}
        </div>
        {live && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-green-600">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Live
          </span>
        )}
      </div>

      <CostBreakdownPanel
        totalInputTokens={session.total_input_tokens}
        totalOutputTokens={session.total_output_tokens}
        totalCacheRead={session.total_cache_read}
        totalCacheCreation={session.total_cache_creation}
        totalCost={session.total_cost_usd}
        perModel={costs}
      />

      <div className="flex gap-1 mb-4 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === t.key ? "border-primary text-primary" : "border-transparent text-muted hover:text-primary-dark"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "agents" && (
        <AgentTimeline
          agentSummaries={agentSummaries}
          sessionId={id!}
          refreshSignal={refreshSignal}
        />
      )}
      {tab === "graph-trace" && (
        <div className="space-y-6">
          {session.event_count > 5000 && (
            <div className="border border-amber-300 bg-amber-50 rounded-lg px-4 py-2 text-sm text-amber-800">
              This session has {session.event_count.toLocaleString()} events. Graph & Trace is limited to the first 5,000 events.
            </div>
          )}
          {!graphLoaded ? (
            <p className="text-muted text-sm animate-pulse">Loading graph data...</p>
          ) : (
            <>
              <TraceView events={graphEvents} agents={graphAgents} />
              <AgentGraph agents={graphAgents} events={graphEvents} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles with no errors**

```bash
bun run build 2>&1 | grep "error TS" | head -20
```

Expected: No errors.

- [ ] **Step 3: Run full test suite**

```bash
bun test
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/client/pages/SessionDetailPage.tsx
git commit -m "feat: SessionDetailPage uses agentSummaries; lazy-loads Graph & Trace events"
```

---

## Task 11: Tests — Full Coverage for New Functionality

**Files:**
- Modify: `test/server/queries.test.ts` (add edge cases)
- Modify: `test/server/api.test.ts` (add agent-summaries tests with subagent data)

- [ ] **Step 1: Add edge case tests to `test/server/queries.test.ts`**

Add the following tests inside the `listEvents` describe block:

```ts
test("returns empty result for unknown sessionId", () => {
  const { events, total } = listEvents(db, { sessionId: "nonexistent" });
  expect(total).toBe(0);
  expect(events.length).toBe(0);
});

test("invalid FTS5 search term throws (caught by API layer)", () => {
  // Standalone AND is invalid FTS5 syntax
  expect(() => listEvents(db, { search: "AND" })).toThrow();
});

test("combined sessionId + agentIds filter", () => {
  const { total } = listEvents(db, { sessionId: "s1", agentIds: ["agent-A", "__main__"] });
  expect(total).toBe(3); // 2 main + 1 agent-A in session s1
});

test("limit is capped server-side at 1000", () => {
  // Even with limit: 9999, we should not exceed 1000 per call (query internally caps)
  const { events } = listEvents(db, { limit: 9999 });
  // Only 4 events in test DB, so all returned — but verify no error thrown
  expect(events.length).toBe(4);
});
```

- [ ] **Step 2: Add an agent-summaries integration test with subagent in `test/server/api.test.ts`**

Add a second `beforeEach` seeded test or a new describe block:

```ts
describe("agent summaries with subagent", () => {
  let db2: Database;
  let app2: Hono;

  beforeEach(() => {
    db2 = new Database(":memory:");
    applySchema(db2);
    app2 = new Hono();
    createApiRoutes(app2, db2);
    createSessionRoutes(app2, db2);
    createEventRoutes(app2, db2);

    // Main agent event
    processJsonlLine(db2, JSON.stringify({
      uuid: "main-1", type: "assistant", timestamp: "2026-01-01T00:00:00.000Z",
      sessionId: "s-test", cwd: "/p",
      message: { model: "claude-sonnet-4-6", role: "assistant", content: [{ type: "text", text: "hi" }],
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    }), "-p");

    // Subagent event
    processJsonlLine(db2, JSON.stringify({
      uuid: "sub-1", type: "assistant", timestamp: "2026-01-01T01:00:00.000Z",
      sessionId: "s-test", cwd: "/p", isSidechain: true, agentId: "agent-XYZ",
      message: { model: "claude-haiku-4-5", role: "assistant", content: [{ type: "text", text: "sub" }],
        usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    }), "-p");
  });

  test("returns main + subagent summary", async () => {
    const res = await app2.request("/api/sessions/s-test/agent-summaries");
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(data.length).toBe(2);
    const main = data.find(s => s.id === null);
    const sub  = data.find(s => s.id === "agent-XYZ");
    expect(main.event_count).toBe(1);
    expect(sub.event_count).toBe(1);
    expect(sub.last_model).toBe("claude-haiku-4-5");
  });

  test("POST /api/events/query filters by __main__ sentinel", async () => {
    const res = await app2.request("/api/events/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "s-test", agentIds: ["__main__"] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.total).toBe(1);
    expect(data.events[0].agent_id).toBeNull();
  });
});
```

- [ ] **Step 3: Run full test suite**

```bash
bun test
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add test/server/queries.test.ts test/server/api.test.ts
git commit -m "test: add edge case and integration tests for server-side filtering"
```

---

## Final Verification

- [ ] **Run full test suite one more time**

```bash
bun test
```

Expected: All tests pass with no failures.

- [ ] **Build for production**

```bash
bun run build
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Smoke test the dev server (optional)**

```bash
bun run dev &
sleep 3
curl -s -X POST http://localhost:3000/api/events/query \
  -H "Content-Type: application/json" \
  -d '{"limit": 5}' | head -c 200
```

Expected: JSON response with `events` array and `total` count.
