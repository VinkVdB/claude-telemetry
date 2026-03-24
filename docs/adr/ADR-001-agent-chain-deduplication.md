# ADR-001: Agent Chain Deduplication via `chain_id`

**Status:** Accepted
**Date:** 2026-03-24

---

## 1. Context and Problem Statement

Claude Code agent teams work by keeping named agents (e.g. `alice`, `bob`) alive across multiple conversation turns via `SendMessage`. Each time an agent receives a message and produces a response, the Claude Code runtime writes a **new transcript file** with a **new `agentId`** derived from the filename (`agent-{id}.jsonl`). That new file does not start fresh — it **replays all prior records** verbatim (same UUIDs, same timestamps), then appends the new turn's records.

The telemetry dashboard used `agentId` as the primary identifier for a logical agent. A single agent receiving 3 messages across a session would therefore appear as **3 separate agent cards** in the UI, each showing only a fraction of the real event count and token usage.

### Evidence

Inspecting a live agent-team session (`4b96aec1`):
- Two agents: `alice` and `bob`, each receiving 3 turns of `SendMessage`
- 6 subagent transcript files on disk (3 per agent)
- All 3 alice files share the same first-record UUID: `edf8bfd8-c77f-449d-892f-7c54f8054d1c`
- All 3 bob files share the same first-record UUID: `91c12977-db10-4034-a40d-21267fe5a597`

Every transcript in the same **chain** shares the same first-record UUID because the first record is the original spawn message, replayed verbatim in every subsequent file. This is the stable, observable handle that links all turns of a logical agent.

---

## 2. Decision Drivers

- **Correctness:** one `Agent` tool invocation = one logical agent; the UI must reflect that
- **Non-destructive:** preserve all per-turn data; do not delete, merge, or remap records
- **Performance:** session pages with millions of events must load in under a second
- **Backward-compatible:** agents ingested before this change must still display correctly
- **Simple query layer:** avoid query-time expansion that would scan large tables

---

## 3. Considered Options

### Option A — Collapse at query time via `GROUP BY COALESCE(chain_id, id)`

Add `chain_id` to the `agents` table. `listAgentSummaries` groups by `COALESCE(chain_id, id)`, summing metrics. `listEvents` expands a chain_id filter to constituent `agentId`s via a subquery or `COALESCE` in the WHERE clause.

**Trade-offs:**
- (+) No schema change to `events`
- (-) `COALESCE(e.chain_id, e.agent_id) IN (?)` in a WHERE clause prevents SQLite from using either index, causing full table scans on large event tables
- (-) `GROUP BY` with `LEFT JOIN` and correlated subqueries produced 30+ second load times on a real dataset
- **Rejected** due to unacceptable performance at scale

### Option B — Remap `events.agent_id` to `chain_id` at ingestion

When a continuation transcript is detected, write new events with the canonical `chain_id` as `agent_id` instead of the file's `agentId`.

**Trade-offs:**
- (+) Simplest query layer — no expansion needed
- (-) Mutates the `agent_id` foreign key, losing per-turn attribution
- (-) Harder to reconstruct turn-level history later
- (-) Requires reprocessing all existing events retroactively
- **Rejected** — too destructive, loses valuable per-turn data

### Option C — Store `chain_id` at write time on both tables, group on the frontend (chosen)

Add `chain_id TEXT` to both `agents` and `events` tables, populated at ingestion time. `listAgentSummaries` returns one row per `agentId` with the `chain_id` field. The frontend groups rows by `chain_id ?? id` to produce logical agent cards. `listEvents` filters using an index-friendly split OR:

```sql
(e.chain_id IN (?) OR (e.chain_id IS NULL AND e.agent_id IN (?)))
```

This allows SQLite to use both `idx_events_chain` and `idx_events_agent` independently.

**Trade-offs:**
- (+) Both indexes used — no full table scans
- (+) `listAgentSummaries` stays as simple per-row correlated subqueries (fast for small agents table)
- (+) Frontend grouping is pure client-side logic, zero DB overhead
- (+) Old agents without `chain_id` fall back to `id` transparently
- **Accepted**

---

## 4. Decision

**Option C** was accepted.

`chain_id` is derived from the `uuid` field of the very first JSONL record in the transcript file. This value is stable and observable without any coordination with the Claude Code runtime — it emerges naturally from the replay-all-prior-records behaviour of agent continuations. All turn transcripts for the same logical agent share this UUID as their first line.

---

## 5. Implementation

### Schema (`schema.ts`)
```sql
ALTER TABLE agents ADD COLUMN chain_id TEXT;
ALTER TABLE events ADD COLUMN chain_id TEXT;
CREATE INDEX idx_agents_chain ON agents(chain_id);
CREATE INDEX idx_events_chain  ON events(chain_id);
```
One-time SQL backfill propagates `chain_id` from `agents` to `events` for rows ingested before this migration.

### Write path (`watcher.ts`)
On first encounter of a subagent file (`/subagents/agent-{id}.jsonl`):
1. Extract `chain_id` from `lines[0]` (already in memory — no extra file read)
2. Cache `agentId → chain_id` in an in-memory `Map`
3. Pass `chain_id` to `processJsonlLine` → stored on every new event
4. `upsertAgent` stores `chain_id` on the agent row

**Cache design:** plain `Map<string, string>`, no eviction limit. On cache miss (e.g. after restart), lazy-load from `agents.chain_id` via a DB query — no file re-read needed. Cache cleared every 24 hours to prevent unbounded growth. This correctly handles switching between old sessions without file I/O.

**Why not a fixed-size slice for the first-line read?**
An earlier attempt used `Bun.file(filePath).slice(0, 512).text()` as a performance optimisation. This silently failed because typical JSONL first lines are ~1300 bytes — the slice cut mid-JSON, `JSON.parse` threw, and the error was swallowed, leaving every `chain_id` as `null`. The fix was to not slice at all: `lines[0]` is already in memory from the main content read when `offset === 0`.

### `upsertAgent` (`queries.ts`)
ON CONFLICT handler uses `COALESCE` to preserve whichever value arrives first:
```sql
chain_id = COALESCE(excluded.chain_id, agents.chain_id)
```
This handles the race where the main session file's sidechain record creates the agent row (no `chain_id`) before the subagent file is processed (has `chain_id`).

### `listAgentSummaries` (`queries.ts`)
Returns one row per `agentId` with `a.chain_id`. Both UNION ALL branches have the same column count (`turn_count` and `chain_id` present in both, `NULL` where not applicable). An earlier bug had the 9th column as `turn_count` for the main agent and `chain_id` for subagents — in a UNION ALL, column names come from the first SELECT, so subagent rows had their `chain_id` string silently aliased as `turn_count`.

### `listEvents` filter (`queries.ts`)
Index-friendly agent filter — avoids `COALESCE` in WHERE:
```sql
(e.chain_id IN (?) OR (e.chain_id IS NULL AND e.agent_id IN (?)))
```

### Frontend (`AgentTimeline.tsx`)
Groups `AgentSummary[]` by `chain_id ?? id` client-side:
- Sums `event_count` and `total_tokens` across all turns
- Shows "N turns" badge when group size > 1
- `visibleAgents` and `hookFilters` operate on chain keys
- `colorMap` / `nameMap` map individual `agentId → chain group's color/name` for EventTable row colouring

### Startup backfill (`watcher.ts`)
On every startup, agents with `chain_id IS NULL` are backfilled by reading the first line of their subagent file. This handles sessions ingested before `chain_id` support was added. Agents successfully backfilled are also populated into the in-memory cache.

---

## 6. Issues Encountered

### Performance regression from query-time grouping
The first implementation used `GROUP BY COALESCE(chain_id, id)` with a LEFT JOIN in `listAgentSummaries`. On a real dataset (millions of events), this caused 30+ second load times. Root cause: the GROUP BY forced a full table scan on `events`. Fix: revert to per-row correlated subqueries for the small `agents` table; move grouping to the frontend.

### `COALESCE` in WHERE kills indexes
`COALESCE(e.chain_id, e.agent_id) IN (?)` prevents SQLite from using either `idx_events_chain` or `idx_events_agent`. Fix: split into two index-friendly conditions with OR.

### UNION ALL column count mismatch
Adding `chain_id` as the 9th column to the subagent SELECT, while the main agent SELECT had `turn_count` as its 9th column, caused subagent rows to have their `chain_id` value silently appear in the `turn_count` field. Fix: both branches now have 10 columns with consistent positions.

### Fixed-size slice truncating first line
`slice(0, 512)` cut JSONL first lines mid-JSON (~1300 bytes typical). `JSON.parse` threw, was caught silently, `chain_id` stayed `null` for every agent. Fix: use `lines[0]` (already in memory) for new files; lazy DB lookup for returning files.

### `ON CONFLICT` silently dropping `chain_id`
The original conflict handler only updated `agent_type` and `ended_at`. When `processJsonlLine` created the agent row from a sidechain record in the main session file (no `chain_id`), then the subagent file was processed and called `upsertAgent` with `chain_id`, the conflict handler would not update it. Fix: add `chain_id = COALESCE(excluded.chain_id, agents.chain_id)` to the conflict handler.

### Hot-reload masking missing schema migration
`bun run --hot` reloads changed modules in-place but never re-runs `applySchema`. The `chain_id` columns were added to `schema.ts` but the running dev server never executed the migration. New `upsertAgent` calls (with `chain_id` in the INSERT) failed silently inside the watcher's try/catch, leaving agents in the DB without `chain_id`. Fix: full process restart required for schema migrations to apply.

---

## 7. Consequences

### Positive
- Dashboard shows exactly as many agent cards as there were `Agent` tool invocations
- Event totals and token counts per logical agent are accurate (summed across all turns)
- "N turns" badge makes the multi-transcript structure discoverable without cluttering the default view
- Fully backward-compatible: agents without `chain_id` are treated as single-turn
- No performance regression — query layer unchanged, grouping is free client-side work

### Negative / Trade-offs
- Agents ingested before this migration will have `chain_id = null` until the startup backfill runs
- `events.chain_id` is denormalised (also stored on `agents`) — kept intentionally for index-friendly filtering

### Neutral
- Per-turn transcript files remain as individual rows in the `agents` table; they are collapsed only in the summary view. Raw per-turn data is preserved.
