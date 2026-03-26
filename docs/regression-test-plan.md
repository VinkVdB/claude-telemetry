# Regression Test Plan — Claude Telemetry Dashboard

## Strategy

Each scenario consists of:
1. A minimal `.jsonl` fixture file in `test/fixtures/scenarios/` covering exactly one behaviour
2. A Playwright test in `test/e2e/` that seeds the DB from that fixture and asserts the UI

The server is started in test mode pointing at an in-memory (or temp-dir) SQLite DB seeded with the fixture.
Playwright hits `http://localhost:<TEST_PORT>` and asserts DOM elements.

---

## Scenario Groups

### 1. Deduplication

| ID | Scenario | Expected |
|----|----------|----------|
| D1 | Single tool call — 3 JSONL lines for same message (streaming partial, partial-with-tool, final with stop_reason=tool_use) | Exactly 1 event row in DB; event shows correct tool_name; tokens from final line |
| D2 | Text-only response — 2 partials (stop_reason=null) + 1 final (stop_reason=end_turn) | Exactly 1 event; stop_reason=end_turn preserved |
| D3 | **Parallel tool calls** — 2 Agent calls in same message, different tool_use_ids, separate JSONL lines | **2 events in DB**, both visible in event viewer as separate "Agent" rows |
| D4 | Streaming partial arrives after final (out-of-order write) | Final wins; no duplicate |
| D5 | Same JSONL file re-ingested from offset 0 (restart) | Event count unchanged; no duplicates |

### 2. Thinking Blocks

| ID | Scenario | Expected |
|----|----------|----------|
| T1 | Pure thinking response (content=[{type:thinking}], stop_reason=end_turn, no tool_use) | Event label shows "end_turn" (or thinking indicator), NOT a tool name |
| T2 | Thinking + tool_use in same response (content=[{type:thinking},{type:tool_use,name:Read}]) | Event label shows "Read", not "thinking" |
| T3 | Tool_use in partial (stop_reason=null), no tool_use in final (stop_reason=end_turn) | Final wins; event label shows stop_reason label, not stale partial tool name |

### 3. Session Naming

| ID | Scenario | Expected |
|----|----------|----------|
| N1 | Session with both `slug` and `custom_slug` set | Session list shows custom_slug |
| N2 | Session with only `slug` (no custom_slug) | Session list shows slug |
| N3 | Session with neither slug | Session list shows first 8 chars of session ID |
| N4 | Rename via UI → API sets custom_slug → page reload | Renamed slug persists across reload |
| N5 | Rename a session → navigate to session detail page | Breadcrumb shows the new custom_slug, not the original slug |
| N6 | Rename a session → return to project session list | Session row in the list shows the new custom_slug |

### 3b. Project Naming

| ID | Scenario | Expected |
|----|----------|----------|
| P1 | Project whose path-derived name contains dashes (e.g. `claude-telemetry`) | Project list and breadcrumb show the full derived name, not just the last segment after a dash |
| P2 | Rename a project via API (`PATCH /api/projects/:id`) → reload project page | Project page heading and breadcrumb show new name |
| P3 | Rename a project → navigate to a session within that project | Session detail page breadcrumb shows the updated project name (fetched from `GET /api/projects/:id`) |
| P4 | Session detail page loads for a session whose project has a multi-word name | Breadcrumb segment reads the full `project.name`, not `project_id.split("-").pop()` |

### 3c. Session Detail Header Stats

| ID | Scenario | Expected |
|----|----------|----------|
| H1 | Navigate directly to a session detail page (GET `/api/sessions/:id`) | Header shows non-zero `event_count` matching the actual number of events in the DB |
| H2 | Session detail header event count matches the total shown in the event table | Both numbers are identical for the same unfiltered session |
| H3 | Session with 0 events (edge case) | Header shows `Events: 0`, not a blank/undefined value |

### 4. Event Table Display

| ID | Scenario | Expected |
|----|----------|----------|
| E1 | `assistant` event with tool_name=Read | Row shows "Read" in tool column |
| E2 | `user` event with tool result content | Row shows correct user label |
| E3 | `system` event | Row shows "system" label |
| E4 | `progress` events hidden by default | No progress rows visible unless filter enabled |
| E5 | Search by tool name — results span entire session (not just current page) | Matching events from all pages returned; searching "skill" finds events beyond the first loaded page |
| E6 | Filter by agent | Only events for selected agent visible |
| E7 | Search in session event viewer returns same results as raw explorer search for same query | Both use server-side FTS5; result counts match |

### 5. Agent Timeline / Parallel Agents

| ID | Scenario | Expected |
|----|----------|----------|
| A1 | Two agents spawned in parallel (D3 fixture) | AgentTimeline shows both agents in separate rows |
| A2 | Agent spawns a sub-agent (nested sidechain) | Both parent and child visible; chain_id grouping correct |
| A3 | Only 1 agent spawned | Only 1 agent row in timeline |

### 5b. Agent Graph — Teammate Message Links

| ID | Scenario | Expected |
|----|----------|----------|
| G1 | Team session with `<teammate-message teammate_id="X">` user events | Graph shows a dashed grey arrow from agent X to the receiving agent |
| G2 | Multiple messages between the same pair of agents | A single dashed edge (deduplicated), not one edge per message |
| G3 | `teammate_id="system"` in a message | No edge drawn for system sender |
| G4 | Agent sending to itself (`agent_id` matches sender chain key) | No self-loop edge drawn |
| G5 | Two agents with the same `agent_type` receiving a message | Dashed edge drawn to all matching nodes |
| G6 | Session with no `<teammate-message>` events | Legend (`spawn` / `message`) is not shown |
| G7 | Session with teammate messages present | Legend appears in bottom-left of the graph |
| G8 | Both a spawn edge and a message edge exist between the same pair | Both edges visible: solid spawn + dashed message, offset sideways so they don't overlap |

### 6. SSE / Real-time Updates

| ID | Scenario | Expected |
|----|----------|----------|
| S1 | New JSONL line appended while event viewer is open | New event appears without page reload |
| S2 | New session file created while project page is open | Session appears in session list without reload |

### 7. Ingestion Edge Cases

| ID | Scenario | Expected |
|----|----------|----------|
| I1 | JSONL line with no uuid | Line skipped; no crash |
| I2 | JSONL line with no sessionId | Line skipped; no crash |
| I3 | Malformed JSON line in middle of file | Malformed line skipped; subsequent lines processed |
| I4 | Git worktree path (cwd contains `.worktrees/`) | Events grouped under parent project, not worktree project |
| I5 | Subagent JSONL file (path contains `/subagents/`) | Events ingested into parent session; agent record created |
| I6 | Subagent with parallel Agent tool calls (D3 scenario via sidechain) | Both child agents visible in event viewer |

---

## Fixture Format

Each fixture is a `.jsonl` file. Helpers in `test/helpers/seed.ts` ingest the fixture into a fresh temp DB before each test:

```ts
// test/helpers/seed.ts
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/server/db/schema";
import { processJsonlLine } from "../../src/server/ingestion/processor";

export function seedFromFixture(db: Database, fixturePath: string, projectSlug = "test-project") {
  applySchema(db);
  const content = Bun.file(fixturePath).textSync();
  for (const line of content.split("\n").filter(l => l.trim())) {
    processJsonlLine(db, line, projectSlug);
  }
}
```

---

## Fixture Files to Create

```
test/fixtures/scenarios/
  d1-single-tool-dedup.jsonl          # D1: 3 lines for same message, same tool_use_id
  d2-text-only-dedup.jsonl            # D2: 2 partials + 1 final, no tool_use
  d3-parallel-agent-calls.jsonl       # D3: 2 Agent calls, same msg_id, different tool_use_ids
  d4-out-of-order.jsonl               # D4: final before partial (simulated by file ordering)
  t1-pure-thinking.jsonl              # T1: thinking block, no tool_use
  t2-thinking-plus-tool.jsonl         # T2: thinking + tool_use in same response
  t3-stale-tool-name.jsonl            # T3: tool in partial but not in final
  n1-custom-slug.jsonl                # N1-N3: slug variations
  i4-git-worktree.jsonl               # I4: cwd with .worktrees/
  i5-subagent.jsonl                   # I5: isSidechain=true events
  g1-teammate-messages.jsonl          # G1-G8: team session with <teammate-message> user events
```

---

## Priority Order for Implementation

1. **D3** (parallel agent calls) — fixes the most user-visible bug
2. **D1, D2** — baseline dedup correctness
3. **T1, T2** — thinking display correctness
4. **A1** — agent timeline with parallel agents
5. **E1–E4** — event table display
6. **N1–N6, P1–P4, H1–H3** — naming and header stats (covers project breadcrumb, session rename, event count regressions)
7. **G1–G8** — agent graph teammate message links
8. **S1, S2** — SSE (requires test server with file watcher)
9. **I1–I6** — ingestion edge cases
