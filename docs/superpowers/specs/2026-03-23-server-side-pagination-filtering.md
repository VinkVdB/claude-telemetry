# Spec: Server-side Pagination & Filtering

**Date:** 2026-03-23
**Status:** Approved
**Scope:** Fix broken pagination in RawExplorer and SessionDetail EventTable when filters/search are active.

---

## Problem

Both `RawExplorer` and `AgentTimeline` apply filters **after** data is loaded from the server:

- **RawExplorer**: `search` text filter is a `.filter()` on the loaded event window. `total` and `offset` remain server-unfiltered, so jump math, scroll triggers, and the status bar all break.
- **AgentTimeline**: `visibleAgents` toggles filter the loaded window client-side. Same pagination math corruption, plus loading a new page that has zero matching agent events causes the scroll-height restore logic to break and appear frozen.

Additionally, `SessionDetailPage` fetches up to 10,000 events to compute per-agent summary card stats — a heavy, unnecessary fetch.

---

## Goals

1. Filtering and search happen in SQLite — `total` always reflects the filtered count.
2. Pagination (jump, scroll, load-more) works correctly under all filter combinations.
3. Agent summary cards are driven by server-side SQL aggregation — no large event array fetch.
4. New events are surfaced immediately: reload if the user is at offset 0; show a "N new events" banner otherwise.
5. Text search is performant at 100k+ rows via SQLite FTS5.
6. All user input goes through parameterized queries — no SQL injection surface.

---

## Architecture

### 1. Database — `src/server/db/schema.ts`

**New indexes** (append to `applySchema`):
```sql
CREATE INDEX IF NOT EXISTS idx_events_session_agent ON events(session_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_events_session_ts    ON events(session_id, timestamp DESC);
```

**FTS5 virtual table** for text search on `raw`:
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS events_fts
  USING fts5(raw, content=events, content_rowid=rowid);
```

Three sync triggers using the FTS5 content-table shadow-row pattern (per SQLite FTS5 docs):
```sql
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
```

**FTS5 backfill — run once, guarded by migration flag** (same pattern as `migration_message_id_dedup`):
```ts
const ftsBackfill = db.query("SELECT value FROM settings WHERE key = 'migration_fts_backfill'").get();
if (!ftsBackfill) {
  db.exec("INSERT INTO events_fts(rowid, raw) SELECT rowid, raw FROM events");
  db.run("INSERT INTO settings (key, value) VALUES ('migration_fts_backfill', '1') ON CONFLICT(key) DO UPDATE SET value='1'");
}
```
This runs synchronously on first startup after the upgrade. On large databases it may take a few seconds — this is acceptable for a local tool. The migration flag prevents re-running on subsequent starts.

---

### 2. Query layer — `src/server/db/queries.ts`

**`listEvents` signature change:**
```ts
export function listEvents(db: Database, filters: {
  sessionId?: string;
  type?: string;
  model?: string;
  toolName?: string;
  agentIds?: string[];   // Wire format: string[] only. "__main__" sentinel maps to agent_id IS NULL.
  search?: string;       // FTS5 match term
  limit?: number;        // Server enforces max 1000; default 100
  offset?: number;
}): { events: Record<string, unknown>[]; total: number }
```

- When `agentIds` is provided: add `agent_id IN (...)` condition. The sentinel `"__main__"` maps to `agent_id IS NULL` using a `CASE` expression or split into two conditions with `OR`.
- When `search` is provided: join to `events_fts` using `WHERE events_fts MATCH ?`. FTS5 match errors bubble up as exceptions — the API layer catches them.
- `limit` is capped at 1000 server-side: `const limit = Math.min(filters.limit ?? 100, 1000)`.
- All user values go through `?` parameters — never interpolated.
- Filter key validation: conditions are built from a hardcoded `COLUMN_MAP` object (not from user-supplied key names), so no injection is possible even structurally.
- Return type is `Record<string, unknown>[]` from raw SQLite rows. The API layer passes them through directly; the client `Event` type in `types.ts` is the authoritative shape. No server-side cast needed.

**New `listAgentSummaries` function:**
```ts
export function listAgentSummaries(db: Database, sessionId: string): AgentSummary[]
```

Returns one row per agent (including a synthesized `main` row for `agent_id IS NULL`) via a UNION ALL query. Both branches must have identical column counts and order. The main row uses `NULL` placeholders for columns that only apply to subagents. Main agent sorts first (NULL `started_at` sorts first with ASC in SQLite — this is intentional and desirable):

```sql
-- Main agent row (always first: NULL started_at sorts before real timestamps)
SELECT
  NULL                    as id,
  'main'                  as agent_type,
  NULL                    as description,
  NULL                    as started_at,
  COUNT(*)                as event_count,
  COALESCE(SUM(input_tokens+output_tokens),0) as total_tokens,
  MAX(timestamp)          as last_active,
  (SELECT model FROM events
   WHERE session_id=? AND agent_id IS NULL AND model IS NOT NULL
   ORDER BY timestamp DESC LIMIT 1) as last_model
FROM events WHERE session_id=? AND agent_id IS NULL

UNION ALL

-- Subagent rows
SELECT
  a.id,
  a.agent_type,
  a.description,
  a.started_at,
  (SELECT COUNT(*) FROM events WHERE agent_id=a.id)                            as event_count,
  (SELECT COALESCE(SUM(input_tokens+output_tokens),0) FROM events WHERE agent_id=a.id) as total_tokens,
  (SELECT MAX(timestamp) FROM events WHERE agent_id=a.id)                      as last_active,
  (SELECT model FROM events WHERE agent_id=a.id AND model IS NOT NULL
   ORDER BY timestamp DESC LIMIT 1)                                            as last_model
FROM agents a WHERE a.session_id=?

ORDER BY started_at ASC
```

Bind array for this query: `[sessionId, sessionId, sessionId]` — the first two for the main branch (subquery + FROM), the third for the subagent branch WHERE clause.

---

### 3. API layer

**`POST /api/events/query`** (replaces `GET /api/events`):
- Accepts JSON body matching the `listEvents` filters shape
- Returns `{ events: Event[]; total: number }`
- **Remove** `GET /api/events` — **defer removal to Task 8** (after `useInfiniteEvents` is updated). The `jumpTo` method inside `useInfiniteEvents` calls `api.events.list` directly (line 188 of hook) in addition to `fetchPage`. Both call sites must be updated in Task 8 before the old route is removed.
- **Error handling:** Wrap the `listEvents` call in a try/catch. If SQLite throws (e.g. invalid FTS5 MATCH syntax from a malformed search term), return HTTP 400 with `{ error: "Invalid search query" }`. Validate that the request body is valid JSON; return 400 for parse errors.

**`GET /api/sessions/:id/agent-summaries`** (new):
- Calls `listAgentSummaries(db, id)`
- Returns `AgentSummary[]`

---

### 4. Client API — `src/client/lib/api.ts`

```ts
events: {
  query: (filters: EventQueryFilters) =>
    post<{ events: Event[]; total: number }>("/events/query", filters),
},
sessions: {
  agentSummaries: (id: string) => get<AgentSummary[]>(`/sessions/${id}/agent-summaries`),
},
```

Add a `post<T>` helper alongside the existing `get<T>`.

---

### 5. `useInfiniteEvents` hook — `src/client/hooks/useInfiniteEvents.ts`

- `filters` type changes from `Record<string, string>` to `UIEventFilters` (typed object that accepts `null` in `agentIds`)
- Inside the hook, before every API call, convert to wire format: replace `null` in `agentIds` with `"__main__"`. This conversion happens in a single `toWireFilters(filters)` helper inside the hook file — not in `api.ts` or the component.
- Both `fetchPage` and `jumpTo` call `api.events.query` (POST). The existing `jumpTo` direct call to `api.events.list` (line 188) must be updated to use `api.events.query` in this same task.
- After Task 8 is complete, remove `GET /api/events` from the API routes.
- No other logic changes — filter-change reset/reload behaviour is unchanged

---

### 6. RawExplorer — `src/client/components/RawExplorer.tsx`

- `search` state moves into `apiFilters` with **300 ms debounce** via `useDebouncedValue` hook
- Remove `filteredEvents` memo — `events` from hook is the display list
- SSE handler: check `offset` from `useInfiniteEvents` result (exposed as `baseOffsetRef.current` in the return value). Guard with `!isLoading` to avoid re-entrant reloads. If `offset === 0 && !isLoading` → `scrollToTop()` (immediate reload); else → increment `newEventCount`.
- Show banner above `EventTable` when `newEventCount > 0`:
  `"3 new events — scroll to top"` (clickable → `scrollToTop()` + reset count to 0)

---

### 7. AgentTimeline — `src/client/components/AgentTimeline.tsx`

- Remove `events: Event[]` prop entirely — no longer needed for summary cards.
- Receive `agentSummaries: AgentSummary[]` from parent instead. The `agents: Agent[]` prop is also removed.
- **Color assignment**: colors are assigned by index position in `agentSummaries` (same as current logic over `agents`). The main entry (id=null) always gets `MAIN_COLOR`; subagents get `AGENT_COLORS[i % AGENT_COLORS.length]` where `i` is their 0-based index among non-main entries. Colors are derived inside the component — not stored in `AgentSummary`.
- **`visibleAgents` initialization**: initialize `Set<string | null>` from `agentSummaries.map(s => s.id)` on first render.
- **`showAll` / `hideAll`**: use `agentSummaries.map(s => s.id)` — no dependency on `agents` prop.
- **Debounce strategy**: `visibleAgents` toggle updates are reflected **optimistically** in the UI immediately (the cards dim/highlight instantly). A separate `debouncedAgentIds` value derived from `visibleAgents` (150 ms debounce) is passed to `useInfiniteEvents`. This way the card toggle feels instant; the event table reload fires 150 ms after the last rapid click.
  - When `debouncedVisibleAgents` equals all agents in `agentSummaries`: omit `agentIds` from filters.
  - When subset: pass visible IDs (hook handles `null → "__main__"` conversion).
- Remove client-side `filteredEvents` memo.
- SSE handler: check `offset` and `isLoading` from hook. If `offset === 0 && !isLoading` → `scrollToTop()`; else → increment `newEventCount` and show banner.

---

### 8. SessionDetailPage — `src/client/pages/SessionDetailPage.tsx`

- Remove `limit: "10000"` events fetch on mount; remove `events` state entirely from this component.
- Fetch `agentSummaries` from new endpoint instead.
- Pass `agentSummaries` to `AgentTimeline` (not `events`). Remove `agents` prop from `AgentTimeline` call site.
- **Event count in header**: replace `events.length` (line 73) with `session.event_count` (already present on the `Session` type from the sessions API).
- **Graph & Trace tab**: lazy-load events only when tab becomes active (guarded by `useEffect` on tab change)
  - Fetch with `limit: 5000`. Known limitation: sessions with more than 5000 events will render incomplete trace/graph data. Show a warning banner in the Graph & Trace tab when `session.event_count > 5000`. Mark as future work to add cursor-based pagination to TraceView/AgentGraph.
- On SSE: re-fetch `session` + `agentSummaries` only (lightweight) — no event array re-fetch

---

### 9. New shared utility — `src/client/hooks/useDebouncedValue.ts`

```ts
export function useDebouncedValue<T>(value: T, delay: number): T
```

Used by RawExplorer (300 ms) and AgentTimeline (150 ms).

---

## Types

New shared type `AgentSummary` in `src/client/lib/types.ts`:
```ts
export interface AgentSummary {
  id: string | null;
  agent_type?: string;
  description?: string | null;
  started_at?: string | null;
  event_count: number;
  total_tokens: number;
  last_active: string | null;
  last_model: string | null;
}
```

Two filter types in `src/client/lib/types.ts`:

```ts
/** UI-side filter shape — agentIds may contain null (representing the "main" agent) */
export interface UIEventFilters {
  sessionId?: string;
  type?: string;
  model?: string;
  toolName?: string;
  agentIds?: (string | null)[];  // null = main agent (no agent_id)
  search?: string;
  limit?: number;
  offset?: number;
}

/** Wire format sent to POST /api/events/query — no null values */
export interface EventQueryFilters {
  sessionId?: string;
  type?: string;
  model?: string;
  toolName?: string;
  agentIds?: string[];  // null replaced by "__main__" sentinel by the hook
  search?: string;
  limit?: number;
  offset?: number;
}
```

`useInfiniteEvents` accepts `UIEventFilters`. `api.events.query` accepts `EventQueryFilters`. The hook converts between them internally via `toWireFilters`.

---

## Agentic Team Structure

When executing this plan, spin up a team of four:

| Role | Responsibility |
|---|---|
| **Developer** | Implements tasks in order, one at a time |
| **Architect** | Answers design questions from Developer; owns this spec |
| **Reviewer** | Validates each completed task against this spec and coding standards |
| **Tester** | Updates/adds tests for each changed module; validates test pass |

Reviewer and Tester run after each task completes before the next begins.

---

## Implementation Tasks (ordered)

1. **DB schema** — add new indexes + FTS5 table + triggers + startup population in `schema.ts`
2. **`EventQueryFilters` + `AgentSummary` types** — add to `src/client/lib/types.ts` (needed by all layers below)
3. **`listEvents` query** — add `agentIds`, `search` params; FTS5 join; allowlist validation
4. **`listAgentSummaries` query** — new UNION query returning per-agent aggregates + main row
5. **API routes** — `POST /api/events/query` (with error handling), `GET /api/sessions/:id/agent-summaries`; keep `GET /api/events` stub for now
6. **`api.ts`** — add `post` helper, `events.query`, `sessions.agentSummaries`; keep `events.list` stub for now
7. **`useDebouncedValue` hook** — simple debounce hook in `src/client/hooks/`
8. **`useInfiniteEvents` hook** — switch to `UIEventFilters`, add `toWireFilters`, call `api.events.query` (POST) in both `fetchPage` and `jumpTo`; remove `GET /api/events` route and `api.events.list` after this task is complete
9. **`RawExplorer`** — move search to server-side with debounce; add SSE banner logic
10. **`AgentTimeline`** — receive `agentSummaries` prop; server-side agent filter with debounce; banner
11. **`SessionDetailPage`** — fetch `agentSummaries`; remove 10k event fetch; lazy-load events for Graph & Trace tab with 5000-event warning
12. **Tests** — update/add tests for `listEvents`, `listAgentSummaries`, `POST /api/events/query`, `GET /api/sessions/:id/agent-summaries`

---

## What Does NOT Change

- `EventTable` component — no changes needed
- `DetailPanel` component — no changes
- SSE broadcaster / watcher — no changes
- `TraceView` / `AgentGraph` — use lazy-loaded events from SessionDetailPage; no internal changes
- Existing `useInfiniteEvents` reset-on-filter-change behaviour — preserved
