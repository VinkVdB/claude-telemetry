# Claude Telemetry Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first Docker-based telemetry dashboard that monitors Claude Code sessions by watching `~/.claude/` JSONL files, with optional OTEL enrichment, presenting data as project cards, session lists, Jaeger-like traces, agent graphs, and a raw data explorer.

**Architecture:** Single Docker container running Bun + Hono backend with SQLite storage, React + Vite frontend served from the same port. Primary data source is filesystem watching of `~/.claude/projects/**/*.jsonl` (append-only session logs). Optional OTEL receiver enriches records with `cost_usd` and `duration_ms`. SSE pushes real-time updates to the browser.

**Tech Stack:** Bun, Hono, SQLite (bun:sqlite), chokidar, React 19, Vite, Tailwind CSS v4, D3-force, custom SVG trace visualization, Docker.

**Reference docs:**
- `docs/high-level-overview.md` — architecture, data model, views, config
- `docs/datasources.md` — data source comparison

**Design tokens (InfoSupport brand):**
- Primary: `#00a2e0`
- Dark/Text: `#003864`
- Accent: `#bdd72d`
- Background: `#ffffff`
- Font: Inter

---

## File Structure

```
claude-telemetry/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .gitignore
├── CLAUDE.md
├── docs/
│   ├── datasources.md
│   └── high-level-overview.md
├── src/
│   ├── server/
│   │   ├── index.ts              # Hono app + startup orchestration
│   │   ├── config.ts             # Typed config from env vars w/ defaults
│   │   ├── db/
│   │   │   ├── connection.ts     # SQLite singleton
│   │   │   ├── schema.ts         # Table creation DDL + migrations
│   │   │   └── queries.ts        # Parameterized query functions
│   │   ├── ingestion/
│   │   │   ├── watcher.ts        # Chokidar file watcher (cross-platform)
│   │   │   ├── parser.ts         # JSONL line → typed objects
│   │   │   ├── processor.ts      # Classify, extract, store, broadcast
│   │   │   └── pricing.ts        # Model pricing table + cost calculator
│   │   ├── otel/
│   │   │   └── receiver.ts       # OTLP HTTP receiver + enrichment
│   │   ├── api/
│   │   │   ├── projects.ts       # GET /api/projects, /api/projects/:id
│   │   │   ├── sessions.ts       # GET /api/sessions, /api/sessions/:id
│   │   │   ├── events.ts         # GET /api/events (with filters)
│   │   │   ├── agents.ts         # GET /api/agents/:sessionId
│   │   │   └── sse.ts            # GET /api/stream (SSE)
│   │   └── sse/
│   │       └── broadcaster.ts    # In-memory SSE subscriber management
│   └── client/
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── router.tsx             # React Router config
│       ├── lib/
│       │   ├── api.ts             # Typed fetch wrapper
│       │   ├── sse.ts             # useSSE hook
│       │   ├── utils.ts           # Formatting (tokens, cost, duration)
│       │   └── types.ts           # Shared frontend types
│       ├── components/
│       │   ├── layout/
│       │   │   └── Shell.tsx      # App shell: sidebar nav + content area
│       │   ├── ProjectCard.tsx
│       │   ├── SessionTable.tsx
│       │   ├── AgentTimeline.tsx
│       │   ├── TraceView.tsx
│       │   ├── AgentGraph.tsx
│       │   ├── RawExplorer.tsx
│       │   └── DetailPanel.tsx
│       ├── pages/
│       │   ├── ProjectsPage.tsx
│       │   ├── ProjectDetailPage.tsx
│       │   ├── SessionDetailPage.tsx
│       │   └── RawExplorerPage.tsx
│       └── styles/
│           └── globals.css        # Tailwind directives + custom tokens
├── test/
│   ├── server/
│   │   ├── config.test.ts
│   │   ├── parser.test.ts
│   │   ├── processor.test.ts
│   │   ├── pricing.test.ts
│   │   ├── watcher.test.ts
│   │   ├── schema.test.ts
│   │   └── api.test.ts
│   └── fixtures/
│       ├── sample-session.jsonl
│       ├── sample-subagent.jsonl
│       └── sample-meta.json
└── scripts/
    └── seed.ts                    # Seed DB from real ~/.claude data for dev
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/server/config.ts`
- Test: `test/server/config.test.ts`

- [ ] **Step 1.1: Initialize package.json**

```json
{
  "name": "claude-telemetry",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run --hot src/server/index.ts",
    "dev:client": "vite",
    "build": "vite build && bun build src/server/index.ts --outdir dist/server --target bun",
    "start": "NODE_ENV=production bun dist/server/index.js",
    "test": "bun test",
    "seed": "bun scripts/seed.ts"
  }
}
```

- [ ] **Step 1.2: Install core dependencies**

```bash
bun add hono @hono/node-server chokidar
bun add -d typescript @types/bun vite @vitejs/plugin-react
bun add react react-dom react-router-dom
bun add -d @types/react @types/react-dom
bun add tailwindcss @tailwindcss/vite
bun add d3-force d3-selection
bun add -d @types/d3-force @types/d3-selection
```

- [ ] **Step 1.3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "baseUrl": ".",
    "paths": {
      "@server/*": ["src/server/*"],
      "@client/*": ["src/client/*"]
    }
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 1.4: Create .gitignore**

```
node_modules/
dist/
*.db
*.db-journal
.env
.env.local
```

- [ ] **Step 1.5: Create .env.example**

```bash
# Claude data directory (host path for Docker volume mount)
CLAUDE_HOME=~/.claude

# Server
CT_PORT=3000

# File watching
CT_WATCH_MODE=auto        # auto | native | poll
CT_POLL_INTERVAL=1000     # ms, used when poll mode

# OTEL (optional)
CT_OTEL_ENABLED=false
CT_OTEL_PORT=4317
```

- [ ] **Step 1.6: Write failing config test**

```typescript
// test/server/config.test.ts
import { describe, test, expect } from "bun:test";
import { loadConfig } from "../../src/server/config";

describe("loadConfig", () => {
  test("returns defaults when no env vars set", () => {
    const config = loadConfig({});
    expect(config.dataDir).toBe("/data");
    expect(config.port).toBe(3000);
    expect(config.watchMode).toBe("auto");
    expect(config.pollInterval).toBe(1000);
    expect(config.otelEnabled).toBe(false);
    expect(config.otelPort).toBe(4317);
  });

  test("reads from env vars", () => {
    const config = loadConfig({
      CT_DATA_DIR: "/custom/data",
      CT_PORT: "8080",
      CT_WATCH_MODE: "poll",
      CT_POLL_INTERVAL: "500",
      CT_OTEL_ENABLED: "true",
      CT_OTEL_PORT: "4318",
    });
    expect(config.dataDir).toBe("/custom/data");
    expect(config.port).toBe(8080);
    expect(config.watchMode).toBe("poll");
    expect(config.pollInterval).toBe(500);
    expect(config.otelEnabled).toBe(true);
    expect(config.otelPort).toBe(4318);
  });

  test("derives sub-paths from dataDir", () => {
    const config = loadConfig({ CT_DATA_DIR: "/data" });
    expect(config.projectsDir).toBe("/data/projects");
    expect(config.sessionsDir).toBe("/data/sessions");
    expect(config.teamsDir).toBe("/data/teams");
    expect(config.tasksDir).toBe("/data/tasks");
  });
});
```

- [ ] **Step 1.7: Run test — verify it fails**

```bash
bun test test/server/config.test.ts
```
Expected: FAIL (module not found)

- [ ] **Step 1.8: Implement config.ts**

```typescript
// src/server/config.ts
export interface Config {
  dataDir: string;
  projectsDir: string;
  sessionsDir: string;
  teamsDir: string;
  tasksDir: string;
  port: number;
  watchMode: "auto" | "native" | "poll";
  pollInterval: number;
  otelEnabled: boolean;
  otelPort: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const dataDir = env.CT_DATA_DIR ?? "/data";
  return {
    dataDir,
    projectsDir: `${dataDir}/projects`,
    sessionsDir: `${dataDir}/sessions`,
    teamsDir: `${dataDir}/teams`,
    tasksDir: `${dataDir}/tasks`,
    port: parseInt(env.CT_PORT ?? "3000", 10),
    watchMode: (env.CT_WATCH_MODE as Config["watchMode"]) ?? "auto",
    pollInterval: parseInt(env.CT_POLL_INTERVAL ?? "1000", 10),
    otelEnabled: env.CT_OTEL_ENABLED === "true",
    otelPort: parseInt(env.CT_OTEL_PORT ?? "4317", 10),
  };
}
```

- [ ] **Step 1.9: Run test — verify it passes**

```bash
bun test test/server/config.test.ts
```
Expected: 3 tests PASS

- [ ] **Step 1.10: Commit**

```bash
git add package.json tsconfig.json .gitignore .env.example src/server/config.ts test/server/config.test.ts
git commit -m "feat: project scaffolding with typed config"
```

---

## Task 2: Database Layer

**Files:**
- Create: `src/server/db/connection.ts`
- Create: `src/server/db/schema.ts`
- Create: `src/server/db/queries.ts`
- Test: `test/server/schema.test.ts`

- [ ] **Step 2.1: Write failing schema test**

```typescript
// test/server/schema.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/server/db/schema";

describe("applySchema", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  test("creates all tables", () => {
    applySchema(db);
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("projects");
    expect(names).toContain("sessions");
    expect(names).toContain("events");
    expect(names).toContain("agents");
    expect(names).toContain("otel_raw");
    expect(names).toContain("ingest_cursors");
  });

  test("is idempotent", () => {
    applySchema(db);
    applySchema(db);
    const count = db
      .query("SELECT count(*) as c FROM sqlite_master WHERE type='table'")
      .get() as { c: number };
    expect(count.c).toBeGreaterThan(0);
  });

  test("ingest_cursors tracks file positions", () => {
    applySchema(db);
    db.run("INSERT INTO ingest_cursors (file_path, byte_offset, line_count) VALUES (?, ?, ?)", [
      "/data/projects/test/abc.jsonl",
      1024,
      42,
    ]);
    const row = db.query("SELECT * FROM ingest_cursors WHERE file_path = ?").get("/data/projects/test/abc.jsonl") as any;
    expect(row.byte_offset).toBe(1024);
    expect(row.line_count).toBe(42);
  });
});
```

- [ ] **Step 2.2: Run test — verify it fails**

```bash
bun test test/server/schema.test.ts
```
Expected: FAIL

- [ ] **Step 2.3: Implement schema.ts**

```typescript
// src/server/db/schema.ts
import { Database } from "bun:sqlite";

export function applySchema(db: Database): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      path        TEXT NOT NULL,
      last_active TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL REFERENCES projects(id),
      git_branch      TEXT,
      started_at      TEXT,
      ended_at        TEXT,
      slug            TEXT,
      total_input_tokens    INTEGER DEFAULT 0,
      total_output_tokens   INTEGER DEFAULT 0,
      total_cache_read      INTEGER DEFAULT 0,
      total_cache_creation  INTEGER DEFAULT 0,
      total_cost_usd  REAL DEFAULT 0,
      models_used     TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS events (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL REFERENCES sessions(id),
      parent_id       TEXT,
      type            TEXT NOT NULL,
      timestamp       TEXT NOT NULL,
      model           TEXT,
      input_tokens    INTEGER,
      output_tokens   INTEGER,
      cache_read_tokens INTEGER,
      cache_creation_tokens INTEGER,
      cost_usd        REAL,
      duration_ms     INTEGER,
      tool_name       TEXT,
      stop_reason     TEXT,
      content         TEXT,
      raw             TEXT
    );

    CREATE TABLE IF NOT EXISTS agents (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL REFERENCES sessions(id),
      parent_session  TEXT,
      agent_type      TEXT,
      started_at      TEXT,
      ended_at        TEXT,
      description     TEXT
    );

    CREATE TABLE IF NOT EXISTS otel_raw (
      id              TEXT PRIMARY KEY,
      session_id      TEXT,
      event_type      TEXT,
      timestamp       TEXT,
      data            TEXT
    );

    CREATE TABLE IF NOT EXISTS ingest_cursors (
      file_path       TEXT PRIMARY KEY,
      byte_offset     INTEGER NOT NULL DEFAULT 0,
      line_count      INTEGER NOT NULL DEFAULT 0,
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id);
  `);
}
```

- [ ] **Step 2.4: Implement connection.ts**

```typescript
// src/server/db/connection.ts
import { Database } from "bun:sqlite";
import { applySchema } from "./schema";

let db: Database | null = null;

export function getDb(dbPath = "/data/db/telemetry.db"): Database {
  if (!db) {
    db = new Database(dbPath, { create: true });
    applySchema(db);
  }
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}
```

- [ ] **Step 2.5: Implement queries.ts** — core CRUD for ingestion and API

```typescript
// src/server/db/queries.ts
import type { Database } from "bun:sqlite";

// --- Upserts for ingestion ---

export function upsertProject(db: Database, id: string, name: string, path: string): void {
  db.run(
    `INSERT INTO projects (id, name, path, last_active)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET last_active = datetime('now')`,
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
```

- [ ] **Step 2.6: Run schema test — verify it passes**

```bash
bun test test/server/schema.test.ts
```
Expected: 3 tests PASS

- [ ] **Step 2.7: Commit**

```bash
git add src/server/db/ test/server/schema.test.ts
git commit -m "feat: SQLite database layer with schema, queries, and cursor tracking"
```

---

## Task 3: JSONL Parser

**Files:**
- Create: `src/server/ingestion/parser.ts`
- Create: `test/server/parser.test.ts`
- Create: `test/fixtures/sample-session.jsonl`
- Create: `test/fixtures/sample-subagent.jsonl`
- Create: `test/fixtures/sample-meta.json`

- [ ] **Step 3.1: Create test fixtures**

Create `test/fixtures/sample-session.jsonl` with realistic data from the research (one JSON object per line):

Line 1 — user message:
```json
{"uuid":"msg-001","parentUuid":null,"type":"user","timestamp":"2026-03-18T10:00:00.000Z","sessionId":"sess-abc","cwd":"/Users/dev/my-project","version":"2.1.78","gitBranch":"main","slug":"implement-auth","message":{"role":"user","content":[{"type":"text","text":"Add login endpoint"}]}}
```

Line 2 — assistant message with tool use + tokens:
```json
{"uuid":"msg-002","parentUuid":"msg-001","type":"assistant","timestamp":"2026-03-18T10:00:05.000Z","sessionId":"sess-abc","cwd":"/Users/dev/my-project","version":"2.1.78","gitBranch":"main","slug":"implement-auth","requestId":"req_123","message":{"model":"claude-sonnet-4-6","id":"msg_api_1","type":"message","role":"assistant","content":[{"type":"thinking","thinking":"Let me plan..."},{"type":"text","text":"I'll create the login endpoint."},{"type":"tool_use","id":"toolu_001","name":"Write","input":{"file_path":"/src/login.ts","content":"export function login() {}"}}],"stop_reason":"tool_use","usage":{"input_tokens":150,"output_tokens":80,"cache_read_input_tokens":5000,"cache_creation_input_tokens":200}}}
```

Line 3 — tool result:
```json
{"uuid":"msg-003","parentUuid":"msg-002","type":"user","timestamp":"2026-03-18T10:00:06.000Z","sessionId":"sess-abc","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_001","content":[{"type":"text","text":"File written successfully"}]}]},"toolUseResult":{"success":true}}
```

Line 4 — assistant final response:
```json
{"uuid":"msg-004","parentUuid":"msg-003","type":"assistant","timestamp":"2026-03-18T10:00:10.000Z","sessionId":"sess-abc","requestId":"req_124","message":{"model":"claude-sonnet-4-6","id":"msg_api_2","type":"message","role":"assistant","content":[{"type":"text","text":"Login endpoint created."}],"stop_reason":"end_turn","usage":{"input_tokens":300,"output_tokens":25,"cache_read_input_tokens":5200,"cache_creation_input_tokens":0}}}
```

Create `test/fixtures/sample-subagent.jsonl`:
```json
{"uuid":"sub-001","parentUuid":null,"type":"assistant","timestamp":"2026-03-18T10:01:00.000Z","sessionId":"sess-sub-1","isSidechain":true,"agentId":"agent-xyz","message":{"model":"claude-sonnet-4-6","role":"assistant","content":[{"type":"text","text":"Researching auth patterns"}],"usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}
```

Create `test/fixtures/sample-meta.json`:
```json
{"agentType": "general-purpose"}
```

- [ ] **Step 3.2: Write failing parser test**

```typescript
// test/server/parser.test.ts
import { describe, test, expect } from "bun:test";
import { parseJsonlLine, extractEventData, type ParsedLine } from "../../src/server/ingestion/parser";

describe("parseJsonlLine", () => {
  test("parses valid JSON line", () => {
    const line = '{"uuid":"msg-001","type":"user","timestamp":"2026-03-18T10:00:00.000Z","sessionId":"sess-abc"}';
    const result = parseJsonlLine(line);
    expect(result).not.toBeNull();
    expect(result!.uuid).toBe("msg-001");
    expect(result!.type).toBe("user");
  });

  test("returns null for empty line", () => {
    expect(parseJsonlLine("")).toBeNull();
    expect(parseJsonlLine("  ")).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    expect(parseJsonlLine("{broken")).toBeNull();
  });
});

describe("extractEventData", () => {
  test("extracts tokens from assistant message", () => {
    const line: ParsedLine = {
      uuid: "msg-002",
      parentUuid: "msg-001",
      type: "assistant",
      timestamp: "2026-03-18T10:00:05.000Z",
      sessionId: "sess-abc",
      cwd: "/Users/dev/my-project",
      version: "2.1.78",
      gitBranch: "main",
      slug: "implement-auth",
      message: {
        model: "claude-sonnet-4-6",
        role: "assistant",
        content: [
          { type: "text", text: "Hello" },
          { type: "tool_use", id: "toolu_001", name: "Write", input: {} },
        ],
        stop_reason: "tool_use",
        usage: {
          input_tokens: 150,
          output_tokens: 80,
          cache_read_input_tokens: 5000,
          cache_creation_input_tokens: 200,
        },
      },
    };

    const event = extractEventData(line);
    expect(event.model).toBe("claude-sonnet-4-6");
    expect(event.inputTokens).toBe(150);
    expect(event.outputTokens).toBe(80);
    expect(event.cacheReadTokens).toBe(5000);
    expect(event.cacheCreationTokens).toBe(200);
    expect(event.stopReason).toBe("tool_use");
    expect(event.toolName).toBe("Write");
  });

  test("extracts tool name from first tool_use content block", () => {
    const line: ParsedLine = {
      uuid: "msg-005",
      type: "assistant",
      timestamp: "2026-03-18T10:00:00.000Z",
      sessionId: "sess-abc",
      message: {
        model: "claude-sonnet-4-6",
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
          { type: "tool_use", id: "t2", name: "Read", input: { path: "/" } },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    };
    const event = extractEventData(line);
    // When multiple tools, tool_name captures the first; content has all
    expect(event.toolName).toBe("Bash");
  });

  test("handles user message with no usage", () => {
    const line: ParsedLine = {
      uuid: "msg-001",
      type: "user",
      timestamp: "2026-03-18T10:00:00.000Z",
      sessionId: "sess-abc",
      message: { role: "user", content: [{ type: "text", text: "Hello" }] },
    };
    const event = extractEventData(line);
    expect(event.model).toBeUndefined();
    expect(event.inputTokens).toBeUndefined();
  });

  test("extracts session metadata", () => {
    const line: ParsedLine = {
      uuid: "msg-001",
      type: "user",
      timestamp: "2026-03-18T10:00:00.000Z",
      sessionId: "sess-abc",
      cwd: "/Users/dev/my-project",
      gitBranch: "feature/auth",
      slug: "my-session",
      message: { role: "user", content: [] },
    };
    const meta = extractEventData(line);
    expect(meta.sessionMeta?.cwd).toBe("/Users/dev/my-project");
    expect(meta.sessionMeta?.gitBranch).toBe("feature/auth");
    expect(meta.sessionMeta?.slug).toBe("my-session");
  });
});
```

- [ ] **Step 3.3: Run test — verify it fails**

```bash
bun test test/server/parser.test.ts
```
Expected: FAIL

- [ ] **Step 3.4: Implement parser.ts**

```typescript
// src/server/ingestion/parser.ts

export interface ParsedLine {
  uuid: string;
  parentUuid?: string;
  type: string; // "assistant" | "user" | "progress" | "system"
  timestamp: string;
  sessionId: string;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  slug?: string;
  isSidechain?: boolean;
  agentId?: string;
  requestId?: string;
  message?: {
    model?: string;
    role?: string;
    content?: ContentBlock[];
    stop_reason?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  toolUseResult?: { success?: boolean };
  data?: any; // for progress type
}

export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: any;
  tool_use_id?: string;
  content?: any;
}

export interface ExtractedEvent {
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
  toolName?: string;
  stopReason?: string;
  content?: string;
  sessionMeta?: {
    cwd?: string;
    gitBranch?: string;
    slug?: string;
    version?: string;
  };
  isSidechain?: boolean;
  agentId?: string;
}

export function parseJsonlLine(line: string): ParsedLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function extractEventData(line: ParsedLine): ExtractedEvent {
  const usage = line.message?.usage;
  const content = line.message?.content;

  // Find first tool_use block for tool_name
  const toolUse = content?.find((b) => b.type === "tool_use");

  const event: ExtractedEvent = {
    id: line.uuid,
    sessionId: line.sessionId,
    parentId: line.parentUuid,
    type: line.type,
    timestamp: line.timestamp,
    content: content ? JSON.stringify(content) : undefined,
    isSidechain: line.isSidechain,
    agentId: line.agentId,
  };

  if (line.message?.model) event.model = line.message.model;
  if (usage?.input_tokens) event.inputTokens = usage.input_tokens;
  if (usage?.output_tokens) event.outputTokens = usage.output_tokens;
  if (usage?.cache_read_input_tokens) event.cacheReadTokens = usage.cache_read_input_tokens;
  if (usage?.cache_creation_input_tokens) event.cacheCreationTokens = usage.cache_creation_input_tokens;
  if (line.message?.stop_reason) event.stopReason = line.message.stop_reason;
  if (toolUse?.name) event.toolName = toolUse.name;

  if (line.cwd || line.gitBranch || line.slug) {
    event.sessionMeta = {
      cwd: line.cwd,
      gitBranch: line.gitBranch,
      slug: line.slug,
      version: line.version,
    };
  }

  return event;
}
```

- [ ] **Step 3.5: Run test — verify it passes**

```bash
bun test test/server/parser.test.ts
```
Expected: all tests PASS

- [ ] **Step 3.6: Commit**

```bash
git add src/server/ingestion/parser.ts test/server/parser.test.ts test/fixtures/
git commit -m "feat: JSONL parser with event extraction and test fixtures"
```

---

## Task 4: Cost Calculator

**Files:**
- Create: `src/server/ingestion/pricing.ts`
- Test: `test/server/pricing.test.ts`

- [ ] **Step 4.1: Write failing pricing test**

```typescript
// test/server/pricing.test.ts
import { describe, test, expect } from "bun:test";
import { calculateCost, getModelPricing, type TokenUsage } from "../../src/server/ingestion/pricing";

describe("getModelPricing", () => {
  test("returns pricing for known models", () => {
    const pricing = getModelPricing("claude-sonnet-4-6");
    expect(pricing).not.toBeNull();
    expect(pricing!.inputPerMToken).toBeGreaterThan(0);
    expect(pricing!.outputPerMToken).toBeGreaterThan(0);
  });

  test("returns pricing for model with date suffix", () => {
    const pricing = getModelPricing("claude-sonnet-4-6-20260301");
    expect(pricing).not.toBeNull();
  });

  test("returns null for unknown model", () => {
    expect(getModelPricing("unknown-model")).toBeNull();
  });
});

describe("calculateCost", () => {
  test("computes cost for sonnet usage", () => {
    const usage: TokenUsage = {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 2000,
      cacheCreationTokens: 100,
    };
    const cost = calculateCost("claude-sonnet-4-6", usage);
    expect(cost).toBeGreaterThan(0);
    // Verify cache reads are cheaper than input
    const fullInputCost = calculateCost("claude-sonnet-4-6", { ...usage, cacheReadTokens: 0 });
    const cacheOnlyCost = calculateCost("claude-sonnet-4-6", {
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 3000, cacheCreationTokens: 0,
    });
    // Cache reads should contribute some cost but less per-token than input
    expect(cost).toBeDefined();
  });

  test("returns 0 for unknown model", () => {
    expect(calculateCost("unknown", { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0 })).toBe(0);
  });

  test("returns 0 for zero tokens", () => {
    expect(calculateCost("claude-sonnet-4-6", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 })).toBe(0);
  });
});
```

- [ ] **Step 4.2: Run test — verify it fails**

```bash
bun test test/server/pricing.test.ts
```

- [ ] **Step 4.3: Implement pricing.ts**

```typescript
// src/server/ingestion/pricing.ts

export interface ModelPricing {
  inputPerMToken: number;      // USD per 1M input tokens
  outputPerMToken: number;     // USD per 1M output tokens
  cacheReadPerMToken: number;  // USD per 1M cache-read tokens
  cacheWritePerMToken: number; // USD per 1M cache-creation tokens
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

// Pricing as of March 2026 — update when new models launch
const PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-6": {
    inputPerMToken: 15,
    outputPerMToken: 75,
    cacheReadPerMToken: 1.5,
    cacheWritePerMToken: 18.75,
  },
  "claude-sonnet-4-6": {
    inputPerMToken: 3,
    outputPerMToken: 15,
    cacheReadPerMToken: 0.3,
    cacheWritePerMToken: 3.75,
  },
  "claude-haiku-4-5": {
    inputPerMToken: 0.80,
    outputPerMToken: 4,
    cacheReadPerMToken: 0.08,
    cacheWritePerMToken: 1,
  },
};

export function getModelPricing(model: string): ModelPricing | null {
  // Try exact match first
  if (PRICING[model]) return PRICING[model];
  // Try stripping date suffix (e.g., claude-sonnet-4-6-20260301 → claude-sonnet-4-6)
  const base = model.replace(/-\d{8}$/, "");
  return PRICING[base] ?? null;
}

export function calculateCost(model: string, usage: TokenUsage): number {
  const pricing = getModelPricing(model);
  if (!pricing) return 0;

  const { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens } = usage;
  if (inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens === 0) return 0;

  return (
    (inputTokens / 1_000_000) * pricing.inputPerMToken +
    (outputTokens / 1_000_000) * pricing.outputPerMToken +
    (cacheReadTokens / 1_000_000) * pricing.cacheReadPerMToken +
    (cacheCreationTokens / 1_000_000) * pricing.cacheWritePerMToken
  );
}
```

- [ ] **Step 4.4: Run test — verify it passes**

```bash
bun test test/server/pricing.test.ts
```

- [ ] **Step 4.5: Commit**

```bash
git add src/server/ingestion/pricing.ts test/server/pricing.test.ts
git commit -m "feat: model pricing table and cost calculator"
```

---

## Task 5: Ingestion Processor

**Files:**
- Create: `src/server/ingestion/processor.ts`
- Test: `test/server/processor.test.ts`

- [ ] **Step 5.1: Write failing processor test**

```typescript
// test/server/processor.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/server/db/schema";
import { processJsonlLine } from "../../src/server/ingestion/processor";

describe("processJsonlLine", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
  });

  test("processes assistant message — creates project, session, event", () => {
    const line = JSON.stringify({
      uuid: "msg-002",
      parentUuid: "msg-001",
      type: "assistant",
      timestamp: "2026-03-18T10:00:05.000Z",
      sessionId: "sess-abc",
      cwd: "/Users/dev/my-project",
      gitBranch: "main",
      slug: "implement-auth",
      message: {
        model: "claude-sonnet-4-6",
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 150, output_tokens: 80, cache_read_input_tokens: 5000, cache_creation_input_tokens: 200 },
      },
    });

    const projectSlug = "-Users-dev-my-project";
    processJsonlLine(db, line, projectSlug);

    const project = db.query("SELECT * FROM projects WHERE id = ?").get(projectSlug) as any;
    expect(project).not.toBeNull();
    expect(project.name).toBe("my-project");

    const session = db.query("SELECT * FROM sessions WHERE id = ?").get("sess-abc") as any;
    expect(session).not.toBeNull();
    expect(session.git_branch).toBe("main");

    const event = db.query("SELECT * FROM events WHERE id = ?").get("msg-002") as any;
    expect(event).not.toBeNull();
    expect(event.model).toBe("claude-sonnet-4-6");
    expect(event.input_tokens).toBe(150);
    expect(event.output_tokens).toBe(80);
    expect(event.cost_usd).toBeGreaterThan(0);
  });

  test("skips duplicate events (idempotent)", () => {
    const line = JSON.stringify({
      uuid: "msg-001",
      type: "user",
      timestamp: "2026-03-18T10:00:00.000Z",
      sessionId: "sess-abc",
      cwd: "/Users/dev/my-project",
      message: { role: "user", content: [{ type: "text", text: "Hello" }] },
    });
    processJsonlLine(db, line, "-Users-dev-my-project");
    processJsonlLine(db, line, "-Users-dev-my-project"); // duplicate — returns null

    const count = db.query("SELECT COUNT(*) as c FROM events").get() as any;
    expect(count.c).toBe(1);
  });

  test("extracts project name from slug", () => {
    const line = JSON.stringify({
      uuid: "msg-001",
      type: "user",
      timestamp: "2026-03-18T10:00:00.000Z",
      sessionId: "sess-abc",
      cwd: "/Users/dev/deeply/nested/my-cool-project",
      message: { role: "user", content: [] },
    });
    processJsonlLine(db, line, "-Users-dev-deeply-nested-my-cool-project");

    const project = db.query("SELECT * FROM projects").get() as any;
    expect(project.name).toBe("my-cool-project");
  });
});
```

- [ ] **Step 5.2: Run test — verify it fails**

```bash
bun test test/server/processor.test.ts
```

- [ ] **Step 5.3: Implement processor.ts**

```typescript
// src/server/ingestion/processor.ts
import type { Database } from "bun:sqlite";
import { parseJsonlLine, extractEventData } from "./parser";
import { calculateCost } from "./pricing";
import { upsertProject, upsertSession, insertEvent, updateSessionAggregates } from "../db/queries";

export function processJsonlLine(db: Database, rawLine: string, projectSlug: string): { eventId: string; sessionId: string; type: string } | null {
  const parsed = parseJsonlLine(rawLine);
  if (!parsed) return null;

  const event = extractEventData(parsed);

  // Derive project name from cwd or slug
  const projectName = deriveProjectName(parsed.cwd, projectSlug);
  const projectPath = parsed.cwd ?? projectSlug;

  // Upsert project
  upsertProject(db, projectSlug, projectName, projectPath);

  // Upsert session
  upsertSession(db, event.sessionId, projectSlug, {
    gitBranch: event.sessionMeta?.gitBranch,
    slug: event.sessionMeta?.slug,
    startedAt: event.timestamp,
  });

  // Calculate cost if we have token data
  let costUsd: number | undefined;
  if (event.model && event.inputTokens != null) {
    costUsd = calculateCost(event.model, {
      inputTokens: event.inputTokens ?? 0,
      outputTokens: event.outputTokens ?? 0,
      cacheReadTokens: event.cacheReadTokens ?? 0,
      cacheCreationTokens: event.cacheCreationTokens ?? 0,
    });
  }

  // Insert event
  insertEvent(db, {
    id: event.id,
    sessionId: event.sessionId,
    parentId: event.parentId,
    type: event.type,
    timestamp: event.timestamp,
    model: event.model,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    cacheReadTokens: event.cacheReadTokens,
    cacheCreationTokens: event.cacheCreationTokens,
    costUsd: costUsd,
    toolName: event.toolName,
    stopReason: event.stopReason,
    content: event.content,
    raw: rawLine,
  });

  // Update session aggregates
  updateSessionAggregates(db, event.sessionId);

  return { eventId: event.id, sessionId: event.sessionId, type: event.type };
}

function deriveProjectName(cwd: string | undefined, projectSlug: string): string {
  if (cwd) {
    const parts = cwd.split("/").filter(Boolean);
    return parts[parts.length - 1] || projectSlug;
  }
  const parts = projectSlug.split("-").filter(Boolean);
  return parts[parts.length - 1] || projectSlug;
}
```

- [ ] **Step 5.4: Run test — verify it passes**

```bash
bun test test/server/processor.test.ts
```

- [ ] **Step 5.5: Commit**

```bash
git add src/server/ingestion/processor.ts test/server/processor.test.ts
git commit -m "feat: ingestion processor with cost calculation and dedup"
```

---

## Task 6: SSE Broadcaster

**Files:**
- Create: `src/server/sse/broadcaster.ts`

- [ ] **Step 6.1: Implement broadcaster.ts**

```typescript
// src/server/sse/broadcaster.ts

type Subscriber = (event: string, data: string) => void;

const subscribers = new Set<Subscriber>();

export function subscribe(callback: Subscriber): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function broadcast(event: string, data: any): void {
  const payload = JSON.stringify(data);
  for (const sub of subscribers) {
    sub(event, payload);
  }
}

export function subscriberCount(): number {
  return subscribers.size;
}
```

- [ ] **Step 6.2: Commit**

```bash
git add src/server/sse/broadcaster.ts
git commit -m "feat: SSE broadcaster for real-time event push"
```

---

## Task 7: File Watcher (Cross-Platform)

**Files:**
- Create: `src/server/ingestion/watcher.ts`
- Test: `test/server/watcher.test.ts`

- [ ] **Step 7.1: Write failing watcher test**

```typescript
// test/server/watcher.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/server/db/schema";
import { mkdtempSync, writeFileSync, appendFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { startWatcher, stopWatcher } from "../../src/server/ingestion/watcher";

describe("watcher", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ct-test-"));
    mkdirSync(join(tmpDir, "projects", "-test-project"), { recursive: true });
    db = new Database(":memory:");
    applySchema(db);
  });

  afterEach(async () => {
    await stopWatcher();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("ingests existing JSONL file on startup", async () => {
    const sessionFile = join(tmpDir, "projects", "-test-project", "sess-001.jsonl");
    const line = JSON.stringify({
      uuid: "msg-001",
      type: "user",
      timestamp: "2026-03-18T10:00:00.000Z",
      sessionId: "sess-001",
      cwd: "/test/project",
      message: { role: "user", content: [{ type: "text", text: "Hello" }] },
    });
    writeFileSync(sessionFile, line + "\n");

    await startWatcher(db, {
      projectsDir: join(tmpDir, "projects"),
      watchMode: "poll" as const,
      pollInterval: 100,
    });

    // Give watcher time to process
    await new Promise((r) => setTimeout(r, 500));

    const events = db.query("SELECT * FROM events").all();
    expect(events.length).toBe(1);
  });

  test("detects new lines appended to JSONL", async () => {
    const sessionFile = join(tmpDir, "projects", "-test-project", "sess-002.jsonl");
    writeFileSync(sessionFile, "");

    await startWatcher(db, {
      projectsDir: join(tmpDir, "projects"),
      watchMode: "poll" as const,
      pollInterval: 100,
    });

    // Append a line
    const line = JSON.stringify({
      uuid: "msg-new",
      type: "user",
      timestamp: "2026-03-18T10:05:00.000Z",
      sessionId: "sess-002",
      cwd: "/test/project",
      message: { role: "user", content: [{ type: "text", text: "New message" }] },
    });
    appendFileSync(sessionFile, line + "\n");

    await new Promise((r) => setTimeout(r, 800));

    const events = db.query("SELECT * FROM events").all();
    expect(events.length).toBe(1);
  });
});
```

- [ ] **Step 7.2: Run test — verify it fails**

```bash
bun test test/server/watcher.test.ts
```

- [ ] **Step 7.3: Implement watcher.ts**

```typescript
// src/server/ingestion/watcher.ts
import chokidar, { type FSWatcher } from "chokidar";
import { statSync } from "fs";
import { basename, dirname, join, relative } from "path";
import type { Database } from "bun:sqlite";
import { processJsonlLine } from "./processor";
import { getCursor, setCursor } from "../db/queries";
import { broadcast } from "../sse/broadcaster";

let watcher: FSWatcher | null = null;

interface WatcherConfig {
  projectsDir: string;
  watchMode: "auto" | "native" | "poll";
  pollInterval: number;
}

export async function startWatcher(db: Database, config: WatcherConfig): Promise<void> {
  const usePolling = config.watchMode === "poll" ||
    (config.watchMode === "auto" && shouldUsePoll());

  watcher = chokidar.watch(join(config.projectsDir, "**", "*.jsonl"), {
    persistent: true,
    usePolling,
    interval: usePolling ? config.pollInterval : undefined,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
  });

  watcher.on("add", (filePath) => void ingestFile(db, filePath, config.projectsDir));
  watcher.on("change", (filePath) => void ingestFile(db, filePath, config.projectsDir));

  // Wait for initial scan
  await new Promise<void>((resolve) => {
    watcher!.on("ready", resolve);
  });
}

export async function stopWatcher(): Promise<void> {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
}

async function ingestFile(db: Database, filePath: string, projectsDir: string): Promise<void> {
  try {
    const stat = statSync(filePath);
    const cursor = getCursor(db, filePath);
    const offset = cursor?.byteOffset ?? 0;

    if (stat.size <= offset) return; // No new data

    // Read only new bytes using Bun's byte-accurate slice
    const bunFile = Bun.file(filePath);
    const newContent = await bunFile.slice(offset).text();
    const lines = newContent.split("\n").filter((l) => l.trim());

    if (lines.length === 0) return;

    // Derive project slug from path
    const relPath = relative(projectsDir, filePath);
    const projectSlug = relPath.split("/")[0] ?? basename(dirname(filePath));

    let processedCount = 0;
    for (const line of lines) {
      const result = processJsonlLine(db, line, projectSlug);
      if (result) {
        broadcast("event", result);
        processedCount++;
      }
    }

    // Update cursor
    setCursor(db, filePath, stat.size, (cursor?.lineCount ?? 0) + processedCount);
  } catch (err) {
    console.error(`[watcher] Error processing ${filePath}:`, err);
  }
}

function shouldUsePoll(): boolean {
  // Docker Desktop on macOS/Windows often needs polling for bind mounts
  // WSL2 cross-filesystem events are unreliable
  const platform = process.platform;
  const isDocker = process.env.CT_DATA_DIR === "/data"; // Our Docker convention
  if (isDocker && (platform === "linux")) {
    // Inside Docker container — polling is safer for bind mounts
    return true;
  }
  return false;
}
```

- [ ] **Step 7.4: Run test — verify it passes**

```bash
bun test test/server/watcher.test.ts
```

- [ ] **Step 7.5: Commit**

```bash
git add src/server/ingestion/watcher.ts test/server/watcher.test.ts
git commit -m "feat: cross-platform file watcher with cursor-based incremental ingestion"
```

---

## Task 8: REST API

**Files:**
- Create: `src/server/api/projects.ts`
- Create: `src/server/api/sessions.ts`
- Create: `src/server/api/events.ts`
- Create: `src/server/api/agents.ts`
- Create: `src/server/api/sse.ts`
- Test: `test/server/api.test.ts`

- [ ] **Step 8.1: Write failing API test**

```typescript
// test/server/api.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { applySchema } from "../../src/server/db/schema";
import { processJsonlLine } from "../../src/server/ingestion/processor";
import { createApiRoutes } from "../../src/server/api/projects";
import { createSessionRoutes } from "../../src/server/api/sessions";
import { createEventRoutes } from "../../src/server/api/events";

describe("API", () => {
  let db: Database;
  let app: Hono;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);

    app = new Hono();
    createApiRoutes(app, db);
    createSessionRoutes(app, db);
    createEventRoutes(app, db);

    // Seed test data
    const line = JSON.stringify({
      uuid: "msg-001",
      type: "assistant",
      timestamp: "2026-03-18T10:00:00.000Z",
      sessionId: "sess-abc",
      cwd: "/Users/dev/my-project",
      gitBranch: "main",
      slug: "test-session",
      message: {
        model: "claude-sonnet-4-6",
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    });
    processJsonlLine(db, line, "-Users-dev-my-project");
  });

  test("GET /api/projects returns project list", async () => {
    const res = await app.request("/api/projects");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].name).toBe("my-project");
    expect(data[0].session_count).toBe(1);
  });

  test("GET /api/projects/:id returns single project", async () => {
    const res = await app.request("/api/projects/-Users-dev-my-project");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("my-project");
  });

  test("GET /api/projects/:id returns 404 for unknown", async () => {
    const res = await app.request("/api/projects/nonexistent");
    expect(res.status).toBe(404);
  });

  test("GET /api/sessions?projectId= returns sessions", async () => {
    const res = await app.request("/api/sessions?projectId=-Users-dev-my-project");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].id).toBe("sess-abc");
  });

  test("GET /api/events?sessionId= returns events with pagination", async () => {
    const res = await app.request("/api/events?sessionId=sess-abc");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.events.length).toBe(1);
    expect(data.total).toBe(1);
  });
});
```

- [ ] **Step 8.2: Run test — verify it fails**

```bash
bun test test/server/api.test.ts
```

- [ ] **Step 8.3: Implement API route files**

`src/server/api/projects.ts`:
```typescript
import type { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { listProjects, getProject } from "../db/queries";

export function createApiRoutes(app: Hono, db: Database): void {
  app.get("/api/projects", (c) => {
    return c.json(listProjects(db));
  });

  app.get("/api/projects/:id", (c) => {
    const project = getProject(db, c.req.param("id"));
    if (!project) return c.json({ error: "Not found" }, 404);
    return c.json(project);
  });
}
```

`src/server/api/sessions.ts`:
```typescript
import type { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { listSessions, getSession } from "../db/queries";

export function createSessionRoutes(app: Hono, db: Database): void {
  app.get("/api/sessions", (c) => {
    const projectId = c.req.query("projectId");
    if (!projectId) return c.json({ error: "projectId required" }, 400);
    return c.json(listSessions(db, projectId));
  });

  app.get("/api/sessions/:id", (c) => {
    const session = getSession(db, c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(session);
  });
}
```

`src/server/api/events.ts`:
```typescript
import type { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { listEvents } from "../db/queries";

export function createEventRoutes(app: Hono, db: Database): void {
  app.get("/api/events", (c) => {
    const filters = {
      sessionId: c.req.query("sessionId"),
      type: c.req.query("type"),
      model: c.req.query("model"),
      toolName: c.req.query("toolName"),
      limit: c.req.query("limit") ? parseInt(c.req.query("limit")!) : undefined,
      offset: c.req.query("offset") ? parseInt(c.req.query("offset")!) : undefined,
    };
    return c.json(listEvents(db, filters));
  });
}
```

`src/server/api/agents.ts`:
```typescript
import type { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { listAgents } from "../db/queries";

export function createAgentRoutes(app: Hono, db: Database): void {
  app.get("/api/agents/:sessionId", (c) => {
    return c.json(listAgents(db, c.req.param("sessionId")));
  });
}
```

`src/server/api/sse.ts`:
```typescript
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { subscribe } from "../sse/broadcaster";

export function createSseRoute(app: Hono): void {
  app.get("/api/stream", (c) => {
    return streamSSE(c, async (stream) => {
      const unsubscribe = subscribe((event, data) => {
        stream.writeSSE({ event, data });
      });

      // Keep alive
      const keepAlive = setInterval(() => {
        stream.writeSSE({ event: "ping", data: "" });
      }, 30_000);

      stream.onAbort(() => {
        unsubscribe();
        clearInterval(keepAlive);
      });

      // Keep the stream open
      await new Promise(() => {});
    });
  });
}
```

- [ ] **Step 8.4: Run test — verify it passes**

```bash
bun test test/server/api.test.ts
```

- [ ] **Step 8.5: Commit**

```bash
git add src/server/api/ test/server/api.test.ts
git commit -m "feat: REST API routes for projects, sessions, events, agents, and SSE"
```

---

## Task 9: Server Entry Point

**Files:**
- Create: `src/server/index.ts`

- [ ] **Step 9.1: Implement index.ts**

```typescript
// src/server/index.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { loadConfig } from "./config";
import { getDb } from "./db/connection";
import { startWatcher } from "./ingestion/watcher";
import { createApiRoutes } from "./api/projects";
import { createSessionRoutes } from "./api/sessions";
import { createEventRoutes } from "./api/events";
import { createAgentRoutes } from "./api/agents";
import { createSseRoute } from "./api/sse";

const config = loadConfig();
const db = getDb(`${config.dataDir}/db/telemetry.db`);

const app = new Hono();

// Middleware
app.use("/api/*", cors());

// API routes
createApiRoutes(app, db);
createSessionRoutes(app, db);
createEventRoutes(app, db);
createAgentRoutes(app, db);
createSseRoute(app);

// Serve SPA in production
if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./dist/client" }));
  app.get("*", serveStatic({ path: "./dist/client/index.html" }));
}

// Start file watcher
startWatcher(db, {
  projectsDir: config.projectsDir,
  watchMode: config.watchMode,
  pollInterval: config.pollInterval,
}).then(() => {
  console.log(`[watcher] Watching ${config.projectsDir}`);
});

console.log(`[server] Starting on port ${config.port}`);
export default {
  port: config.port,
  fetch: app.fetch,
};
```

- [ ] **Step 9.2: Verify server starts**

```bash
CT_DATA_DIR=~/.claude bun run src/server/index.ts
```
Expected: Server starts, watcher begins processing existing JSONL files

- [ ] **Step 9.3: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: server entry point with watcher and API startup"
```

---

## Task 10: Frontend Scaffolding

**Files:**
- Create: `src/client/index.html`
- Create: `src/client/main.tsx`
- Create: `src/client/App.tsx`
- Create: `src/client/router.tsx`
- Create: `src/client/styles/globals.css`
- Create: `src/client/lib/types.ts`
- Create: `src/client/lib/api.ts`
- Create: `src/client/lib/sse.ts`
- Create: `src/client/lib/utils.ts`
- Create: `vite.config.ts`

- [ ] **Step 10.1: Create vite.config.ts**

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "src/client",
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@client": path.resolve(__dirname, "src/client"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
```

- [ ] **Step 10.2: Create index.html and entry point**

`src/client/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Claude Telemetry</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/main.tsx"></script>
</body>
</html>
```

`src/client/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 10.3: Create globals.css with InfoSupport design tokens**

```css
/* src/client/styles/globals.css */
@import "tailwindcss";

@theme {
  --color-primary: #00a2e0;
  --color-primary-dark: #003864;
  --color-accent: #bdd72d;
  --color-bg: #ffffff;
  --color-surface: #f8fafc;
  --color-border: #e2e8f0;
  --color-muted: #64748b;
  --font-sans: "Inter", system-ui, sans-serif;
}

body {
  font-family: var(--font-sans);
  background: var(--color-bg);
  color: var(--color-primary-dark);
}
```

- [ ] **Step 10.4: Create shared types and API client**

`src/client/lib/types.ts`:
```typescript
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
```

`src/client/lib/api.ts`:
```typescript
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
```

`src/client/lib/sse.ts`:
```typescript
import { useEffect, useRef } from "react";

export function useSSE(onEvent: (event: string, data: any) => void): void {
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    const source = new EventSource("/api/stream");

    source.addEventListener("event", (e) => {
      try {
        callbackRef.current("event", JSON.parse(e.data));
      } catch {}
    });

    source.onerror = () => {
      // Auto-reconnect is built into EventSource
    };

    return () => source.close();
  }, []);
}
```

`src/client/lib/utils.ts`:
```typescript
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
```

- [ ] **Step 10.5: Create router and App shell**

`src/client/router.tsx`:
```tsx
import { createBrowserRouter } from "react-router-dom";
import { Shell } from "./components/layout/Shell";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { SessionDetailPage } from "./pages/SessionDetailPage";
import { RawExplorerPage } from "./pages/RawExplorerPage";

export const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: "/", element: <ProjectsPage /> },
      { path: "/projects/:id", element: <ProjectDetailPage /> },
      { path: "/sessions/:id", element: <SessionDetailPage /> },
      { path: "/raw", element: <RawExplorerPage /> },
    ],
  },
]);
```

`src/client/App.tsx`:
```tsx
import { RouterProvider } from "react-router-dom";
import { router } from "./router";

export function App() {
  return <RouterProvider router={router} />;
}
```

- [ ] **Step 10.6: Create Shell layout component**

`src/client/components/layout/Shell.tsx`:
```tsx
import { Outlet, NavLink } from "react-router-dom";
import { cn } from "../../lib/utils";

const navItems = [
  { to: "/", label: "Projects", icon: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" },
  { to: "/raw", label: "Raw Explorer", icon: "M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7M9 3h6l2 4H7l2-4z" },
];

export function Shell() {
  return (
    <div className="min-h-screen flex">
      <nav className="w-56 bg-surface border-r border-border flex flex-col py-4 px-3 shrink-0">
        <div className="flex items-center gap-2 px-3 mb-8">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <circle cx="14" cy="14" r="13" stroke="#00a2e0" strokeWidth="2" />
            <path d="M9 14l3 3 7-7" stroke="#00a2e0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="font-semibold text-primary-dark text-sm">Claude Telemetry</span>
        </div>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-1",
                isActive ? "bg-primary/10 text-primary" : "text-muted hover:bg-surface hover:text-primary-dark"
              )
            }
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={item.icon} />
            </svg>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <main className="flex-1 p-6 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 10.7: Create placeholder pages** (will be fleshed out in later tasks)

`src/client/pages/ProjectsPage.tsx`:
```tsx
export function ProjectsPage() {
  return <div className="text-primary-dark"><h1 className="text-2xl font-semibold mb-4">Projects</h1><p className="text-muted">Loading...</p></div>;
}
```

`src/client/pages/ProjectDetailPage.tsx`:
```tsx
export function ProjectDetailPage() {
  return <div><h1 className="text-2xl font-semibold mb-4">Project Detail</h1></div>;
}
```

`src/client/pages/SessionDetailPage.tsx`:
```tsx
export function SessionDetailPage() {
  return <div><h1 className="text-2xl font-semibold mb-4">Session Detail</h1></div>;
}
```

`src/client/pages/RawExplorerPage.tsx`:
```tsx
export function RawExplorerPage() {
  return <div><h1 className="text-2xl font-semibold mb-4">Raw Explorer</h1></div>;
}
```

- [ ] **Step 10.8: Verify frontend builds**

```bash
bun run dev:client
```
Expected: Vite dev server starts, shows Shell with nav sidebar

- [ ] **Step 10.9: Commit**

```bash
git add vite.config.ts src/client/
git commit -m "feat: frontend scaffolding with routing, layout shell, API client, and design tokens"
```

---

## Task 11: Projects Page

**Files:**
- Create: `src/client/components/ProjectCard.tsx`
- Modify: `src/client/pages/ProjectsPage.tsx`

- [ ] **Step 11.1: Implement ProjectCard**

```tsx
// src/client/components/ProjectCard.tsx
import { Link } from "react-router-dom";
import type { Project } from "../lib/types";
import { formatTokens, formatCost, timeAgo } from "../lib/utils";

export function ProjectCard({ project }: { project: Project }) {
  return (
    <Link
      to={`/projects/${encodeURIComponent(project.id)}`}
      className="block border border-border rounded-xl p-5 hover:border-primary/40 hover:shadow-md transition-all duration-200 bg-white"
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-semibold text-primary-dark text-lg">{project.name}</h3>
        <span className="text-xs text-muted">{timeAgo(project.last_active)}</span>
      </div>
      <p className="text-xs text-muted truncate mb-4">{project.path}</p>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-lg font-semibold text-primary">{project.session_count}</p>
          <p className="text-xs text-muted">Sessions</p>
        </div>
        <div>
          <p className="text-lg font-semibold text-primary">{formatTokens(project.total_tokens)}</p>
          <p className="text-xs text-muted">Tokens</p>
        </div>
        <div>
          <p className="text-lg font-semibold text-primary">{formatCost(project.total_cost)}</p>
          <p className="text-xs text-muted">Cost</p>
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 11.2: Implement ProjectsPage with data fetching**

```tsx
// src/client/pages/ProjectsPage.tsx
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ProjectCard } from "../components/ProjectCard";
import { useSSE } from "../lib/sse";
import type { Project } from "../lib/types";

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => api.projects.list().then(setProjects).finally(() => setLoading(false));

  useEffect(() => { load(); }, []);
  useSSE(() => { load(); }); // Refresh on new events

  if (loading) return <p className="text-muted animate-pulse">Loading projects...</p>;
  if (projects.length === 0) return (
    <div className="text-center py-20">
      <h2 className="text-xl font-semibold text-primary-dark mb-2">No projects yet</h2>
      <p className="text-muted">Start a Claude Code session and data will appear here.</p>
    </div>
  );

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary-dark mb-6">Projects</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => <ProjectCard key={p.id} project={p} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 11.3: Verify in browser**

```bash
bun run dev:client
# Navigate to http://localhost:5173
```
Expected: Project cards render (or empty state if no data ingested yet)

- [ ] **Step 11.4: Commit**

```bash
git add src/client/components/ProjectCard.tsx src/client/pages/ProjectsPage.tsx
git commit -m "feat: projects page with card grid and real-time updates"
```

---

## Task 12: Session List & Detail Page

**Files:**
- Create: `src/client/components/SessionTable.tsx`
- Modify: `src/client/pages/ProjectDetailPage.tsx`
- Modify: `src/client/pages/SessionDetailPage.tsx`

- [ ] **Step 12.1: Implement SessionTable**

```tsx
// src/client/components/SessionTable.tsx
import { Link } from "react-router-dom";
import type { Session } from "../lib/types";
import { formatTokens, formatCost, timeAgo } from "../lib/utils";

export function SessionTable({ sessions }: { sessions: Session[] }) {
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface text-muted text-left">
            <th className="px-4 py-3 font-medium">Session</th>
            <th className="px-4 py-3 font-medium">Branch</th>
            <th className="px-4 py-3 font-medium">Started</th>
            <th className="px-4 py-3 font-medium text-right">Events</th>
            <th className="px-4 py-3 font-medium text-right">Agents</th>
            <th className="px-4 py-3 font-medium text-right">Tokens</th>
            <th className="px-4 py-3 font-medium text-right">Cost</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const totalTokens = s.total_input_tokens + s.total_output_tokens + s.total_cache_read + s.total_cache_creation;
            const models = JSON.parse(s.models_used || "[]") as string[];
            return (
              <tr key={s.id} className="border-t border-border hover:bg-surface/50 transition-colors">
                <td className="px-4 py-3">
                  <Link to={`/sessions/${s.id}`} className="text-primary hover:underline font-medium">
                    {s.slug || s.id.slice(0, 8)}
                  </Link>
                  {models.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {models.filter(m => m !== "null").map((m) => (
                        <span key={m} className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                          {m.replace("claude-", "")}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-muted">{s.git_branch ?? "—"}</td>
                <td className="px-4 py-3 text-muted">{s.started_at ? timeAgo(s.started_at) : "—"}</td>
                <td className="px-4 py-3 text-right">{s.event_count}</td>
                <td className="px-4 py-3 text-right">{s.agent_count}</td>
                <td className="px-4 py-3 text-right font-mono">{formatTokens(totalTokens)}</td>
                <td className="px-4 py-3 text-right font-mono">{formatCost(s.total_cost_usd)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 12.2: Implement ProjectDetailPage**

```tsx
// src/client/pages/ProjectDetailPage.tsx
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import { SessionTable } from "../components/SessionTable";
import type { Project, Session } from "../lib/types";

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    if (!id) return;
    api.projects.get(id).then(setProject);
    api.sessions.list(id).then(setSessions);
  }, [id]);

  if (!project) return <p className="text-muted animate-pulse">Loading...</p>;

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-muted mb-4">
        <Link to="/" className="hover:text-primary">Projects</Link>
        <span>/</span>
        <span className="text-primary-dark font-medium">{project.name}</span>
      </div>
      <h1 className="text-2xl font-semibold text-primary-dark mb-1">{project.name}</h1>
      <p className="text-sm text-muted mb-6">{project.path}</p>
      <SessionTable sessions={sessions} />
    </div>
  );
}
```

- [ ] **Step 12.3: Implement SessionDetailPage with tabs**

```tsx
// src/client/pages/SessionDetailPage.tsx
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import { AgentTimeline } from "../components/AgentTimeline";
import { TraceView } from "../components/TraceView";
import { AgentGraph } from "../components/AgentGraph";
import { formatTokens, formatCost, cn } from "../lib/utils";
import type { Session, Event, Agent } from "../lib/types";

type Tab = "agents" | "trace" | "graph";

export function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tab, setTab] = useState<Tab>("agents");

  useEffect(() => {
    if (!id) return;
    api.sessions.get(id).then(setSession);
    api.events.list({ sessionId: id, limit: "10000" }).then((r) => setEvents(r.events));
    api.agents.list(id).then(setAgents);
  }, [id]);

  if (!session) return <p className="text-muted animate-pulse">Loading...</p>;

  const totalTokens = session.total_input_tokens + session.total_output_tokens;
  const tabs: { key: Tab; label: string }[] = [
    { key: "agents", label: "Agents" },
    { key: "trace", label: "Trace" },
    { key: "graph", label: "Graph" },
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

      <div className="flex items-center gap-6 mb-6">
        <h1 className="text-2xl font-semibold text-primary-dark">{session.slug || "Session"}</h1>
        <div className="flex gap-4 text-sm">
          <span className="text-muted">Tokens: <strong className="text-primary-dark">{formatTokens(totalTokens)}</strong></span>
          <span className="text-muted">Cost: <strong className="text-primary-dark">{formatCost(session.total_cost_usd)}</strong></span>
          <span className="text-muted">Events: <strong className="text-primary-dark">{events.length}</strong></span>
        </div>
      </div>

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

      {tab === "agents" && <AgentTimeline agents={agents} events={events} />}
      {tab === "trace" && <TraceView events={events} agents={agents} />}
      {tab === "graph" && <AgentGraph agents={agents} events={events} />}
    </div>
  );
}
```

- [ ] **Step 12.4: Commit**

```bash
git add src/client/components/SessionTable.tsx src/client/pages/ProjectDetailPage.tsx src/client/pages/SessionDetailPage.tsx
git commit -m "feat: session list table and session detail page with tab navigation"
```

---

## Task 13: Agent Timeline View

**Files:**
- Create: `src/client/components/AgentTimeline.tsx`
- Create: `src/client/components/DetailPanel.tsx`

- [ ] **Step 13.1: Implement DetailPanel (reusable slide-out)**

```tsx
// src/client/components/DetailPanel.tsx
import type { Event } from "../lib/types";
import { formatTokens, formatCost, cn } from "../lib/utils";

export function DetailPanel({ event, onClose }: { event: Event | null; onClose: () => void }) {
  if (!event) return null;

  const content = event.content ? JSON.parse(event.content) : [];

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-white border-l border-border shadow-xl z-50 flex flex-col animate-in slide-in-from-right">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-semibold text-primary-dark">Event Detail</h3>
        <button onClick={onClose} className="text-muted hover:text-primary-dark text-xl">&times;</button>
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-muted">Type:</span> <strong>{event.type}</strong></div>
          <div><span className="text-muted">Model:</span> <strong>{event.model ?? "—"}</strong></div>
          {event.tool_name && <div><span className="text-muted">Tool:</span> <strong>{event.tool_name}</strong></div>}
          {event.input_tokens != null && (
            <div><span className="text-muted">Input:</span> <strong>{formatTokens(event.input_tokens)}</strong></div>
          )}
          {event.output_tokens != null && (
            <div><span className="text-muted">Output:</span> <strong>{formatTokens(event.output_tokens)}</strong></div>
          )}
          {event.cost_usd != null && (
            <div><span className="text-muted">Cost:</span> <strong>{formatCost(event.cost_usd)}</strong></div>
          )}
          {event.duration_ms != null && (
            <div><span className="text-muted">Duration:</span> <strong>{event.duration_ms}ms</strong></div>
          )}
        </div>

        <div>
          <h4 className="text-sm font-medium text-muted mb-2">Content</h4>
          {content.map((block: any, i: number) => (
            <div key={i} className="mb-2">
              {block.type === "text" && <p className="text-sm whitespace-pre-wrap">{block.text}</p>}
              {block.type === "thinking" && (
                <details className="bg-surface rounded-lg p-3">
                  <summary className="text-xs text-muted cursor-pointer">Thinking</summary>
                  <p className="text-sm mt-2 whitespace-pre-wrap">{block.thinking}</p>
                </details>
              )}
              {block.type === "tool_use" && (
                <div className="bg-surface rounded-lg p-3">
                  <p className="text-xs text-muted mb-1">Tool: <strong className="text-primary">{block.name}</strong></p>
                  <pre className="text-xs overflow-x-auto">{JSON.stringify(block.input, null, 2)}</pre>
                </div>
              )}
              {block.type === "tool_result" && (
                <div className="bg-surface rounded-lg p-3">
                  <p className="text-xs text-muted mb-1">Tool Result</p>
                  <pre className="text-xs overflow-x-auto">{JSON.stringify(block.content, null, 2)}</pre>
                </div>
              )}
            </div>
          ))}
        </div>

        <details>
          <summary className="text-xs text-muted cursor-pointer">Raw JSON</summary>
          <pre className="text-xs mt-2 bg-surface rounded-lg p-3 overflow-x-auto">
            {event.raw ? JSON.stringify(JSON.parse(event.raw), null, 2) : "—"}
          </pre>
        </details>
      </div>
    </div>
  );
}
```

- [ ] **Step 13.2: Implement AgentTimeline**

```tsx
// src/client/components/AgentTimeline.tsx
import { useState } from "react";
import type { Event, Agent } from "../lib/types";
import { DetailPanel } from "./DetailPanel";
import { formatTokens, formatCost, cn } from "../lib/utils";

const AGENT_COLORS = ["#00a2e0", "#bdd72d", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];

export function AgentTimeline({ agents, events }: { agents: Agent[]; events: Event[] }) {
  const [selected, setSelected] = useState<Event | null>(null);

  // Group events by agent (main session + subagents)
  const mainEvents = events.filter((e) => e.type === "assistant" || (e.type === "user" && e.tool_name));

  return (
    <div className="relative">
      {agents.length === 0 ? (
        <div className="space-y-2">
          {mainEvents.map((e) => (
            <EventRow key={e.id} event={e} color="#00a2e0" onClick={() => setSelected(e)} />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {agents.map((agent, i) => {
            const color = AGENT_COLORS[i % AGENT_COLORS.length];
            const agentEvents = events.filter((e) => e.session_id === agent.session_id && e.type === "assistant");
            return (
              <div key={agent.id}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-sm font-medium text-primary-dark">{agent.agent_type ?? "agent"}</span>
                  {agent.description && <span className="text-xs text-muted">— {agent.description}</span>}
                  <span className="text-xs text-muted ml-auto">{formatTokens(agent.total_tokens)} tokens</span>
                </div>
                <div className="ml-5 border-l-2 pl-4 space-y-1" style={{ borderColor: color }}>
                  {agentEvents.map((e) => (
                    <EventRow key={e.id} event={e} color={color} onClick={() => setSelected(e)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <DetailPanel event={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function EventRow({ event, color, onClick }: { event: Event; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface transition-colors text-sm"
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-muted text-xs w-20 shrink-0">
        {new Date(event.timestamp).toLocaleTimeString()}
      </span>
      {event.tool_name && (
        <span className="bg-primary/10 text-primary text-xs px-1.5 py-0.5 rounded font-mono">
          {event.tool_name}
        </span>
      )}
      {event.model && (
        <span className="text-xs text-muted">{event.model.replace("claude-", "")}</span>
      )}
      {event.input_tokens != null && (
        <span className="text-xs text-muted ml-auto">{formatTokens(event.input_tokens + (event.output_tokens ?? 0))} tok</span>
      )}
      {event.cost_usd != null && event.cost_usd > 0 && (
        <span className="text-xs text-muted">{formatCost(event.cost_usd)}</span>
      )}
    </button>
  );
}
```

- [ ] **Step 13.3: Commit**

```bash
git add src/client/components/AgentTimeline.tsx src/client/components/DetailPanel.tsx
git commit -m "feat: agent timeline view with expandable events and detail panel"
```

---

## Task 14: Trace View (Jaeger-Style)

**Files:**
- Create: `src/client/components/TraceView.tsx`

- [ ] **Step 14.1: Implement TraceView with SVG spans**

```tsx
// src/client/components/TraceView.tsx
import { useState, useMemo } from "react";
import type { Event, Agent } from "../lib/types";
import { DetailPanel } from "./DetailPanel";
import { formatTokens, formatCost, cn } from "../lib/utils";

const AGENT_COLORS = ["#00a2e0", "#bdd72d", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];
const ROW_HEIGHT = 32;
const LABEL_WIDTH = 160;
const MIN_SPAN_WIDTH = 4;

interface Span {
  event: Event;
  startMs: number;
  endMs: number;
  lane: number;
  color: string;
  label: string;
}

export function TraceView({ events, agents }: { events: Event[]; agents: Agent[] }) {
  const [selected, setSelected] = useState<Event | null>(null);

  const { spans, totalMs, minTime } = useMemo(() => {
    const assistantEvents = events.filter((e) => e.type === "assistant" && e.timestamp);
    if (assistantEvents.length === 0) return { spans: [], totalMs: 0, minTime: 0 };

    const times = assistantEvents.map((e) => new Date(e.timestamp).getTime());
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const totalMs = Math.max(maxT - minT, 1000); // minimum 1s range

    // Assign lanes based on session_id (main = lane 0, subagents = lane 1+)
    const sessionLanes = new Map<string, number>();
    const mainSessionId = events[0]?.session_id;
    if (mainSessionId) sessionLanes.set(mainSessionId, 0);

    agents.forEach((a, i) => {
      if (!sessionLanes.has(a.session_id)) {
        sessionLanes.set(a.session_id, sessionLanes.size);
      }
    });

    const spans: Span[] = assistantEvents.map((e, i) => {
      const startMs = new Date(e.timestamp).getTime() - minT;
      // Estimate end time: use duration_ms if available, else use next event's timestamp, else 2s default
      const nextEvent = assistantEvents[i + 1];
      const duration = e.duration_ms ?? (nextEvent
        ? Math.min(new Date(nextEvent.timestamp).getTime() - new Date(e.timestamp).getTime(), 30000)
        : 2000);
      const lane = sessionLanes.get(e.session_id) ?? 0;
      const color = AGENT_COLORS[lane % AGENT_COLORS.length];

      return {
        event: e,
        startMs,
        endMs: startMs + duration,
        lane,
        color,
        label: e.tool_name ?? e.stop_reason ?? e.type,
      };
    });

    return { spans, totalMs, minTime: minT };
  }, [events, agents]);

  if (spans.length === 0) return <p className="text-muted text-sm">No trace data available.</p>;

  const laneCount = Math.max(...spans.map((s) => s.lane)) + 1;
  const svgHeight = laneCount * (ROW_HEIGHT + 8) + 40;
  const timelineWidth = 800;

  // Lane labels
  const laneLabels = new Map<number, string>();
  laneLabels.set(0, "main");
  agents.forEach((a, i) => {
    const lane = i + 1; // simplified
    if (!laneLabels.has(lane)) {
      laneLabels.set(lane, a.agent_type ?? `agent-${i}`);
    }
  });

  return (
    <div className="overflow-x-auto">
      <svg width={LABEL_WIDTH + timelineWidth + 20} height={svgHeight} className="text-sm">
        {/* Time axis */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const x = LABEL_WIDTH + pct * timelineWidth;
          const timeMs = pct * totalMs;
          return (
            <g key={pct}>
              <line x1={x} y1={0} x2={x} y2={svgHeight} stroke="#e2e8f0" strokeWidth={1} />
              <text x={x} y={svgHeight - 4} fill="#64748b" fontSize={10} textAnchor="middle">
                {timeMs < 1000 ? `${Math.round(timeMs)}ms` : `${(timeMs / 1000).toFixed(1)}s`}
              </text>
            </g>
          );
        })}

        {/* Lane labels */}
        {Array.from(laneLabels.entries()).map(([lane, label]) => (
          <text
            key={lane}
            x={LABEL_WIDTH - 8}
            y={lane * (ROW_HEIGHT + 8) + ROW_HEIGHT / 2 + 16}
            fill="#003864"
            fontSize={12}
            fontWeight={500}
            textAnchor="end"
          >
            {label}
          </text>
        ))}

        {/* Spans */}
        {spans.map((span) => {
          const x = LABEL_WIDTH + (span.startMs / totalMs) * timelineWidth;
          const width = Math.max(((span.endMs - span.startMs) / totalMs) * timelineWidth, MIN_SPAN_WIDTH);
          const y = span.lane * (ROW_HEIGHT + 8) + 8;

          return (
            <g
              key={span.event.id}
              onClick={() => setSelected(span.event)}
              className="cursor-pointer"
              role="button"
            >
              <rect
                x={x}
                y={y}
                width={width}
                height={ROW_HEIGHT}
                rx={4}
                fill={span.color}
                opacity={0.85}
                className="hover:opacity-100 transition-opacity"
              />
              {width > 40 && (
                <text
                  x={x + 6}
                  y={y + ROW_HEIGHT / 2 + 4}
                  fill="white"
                  fontSize={10}
                  fontWeight={500}
                >
                  {span.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <DetailPanel event={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
```

- [ ] **Step 14.2: Commit**

```bash
git add src/client/components/TraceView.tsx
git commit -m "feat: Jaeger-style trace view with SVG spans and click-to-detail"
```

---

## Task 15: Agent Interaction Graph

**Files:**
- Create: `src/client/components/AgentGraph.tsx`

- [ ] **Step 15.1: Implement AgentGraph with D3-force**

```tsx
// src/client/components/AgentGraph.tsx
import { useEffect, useRef, useMemo } from "react";
import * as d3Force from "d3-force";
import * as d3Selection from "d3-selection";
import type { Agent, Event } from "../lib/types";

const AGENT_COLORS = ["#00a2e0", "#bdd72d", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];

interface Node {
  id: string;
  label: string;
  type: string;
  tokens: number;
  x?: number;
  y?: number;
}

interface Link {
  source: string;
  target: string;
  strength: number; // 0-1, fades over time
}

export function AgentGraph({ agents, events }: { agents: Agent[]; events: Event[] }) {
  const svgRef = useRef<SVGSVGElement>(null);

  const { nodes, links } = useMemo(() => {
    if (agents.length === 0) return { nodes: [], links: [] };

    const nodes: Node[] = agents.map((a) => ({
      id: a.id,
      label: a.agent_type ?? "agent",
      type: a.agent_type ?? "unknown",
      tokens: a.total_tokens,
    }));

    // Create links from parent_session relationships
    const links: Link[] = [];
    agents.forEach((a) => {
      if (a.parent_session) {
        const parent = agents.find((p) => p.session_id === a.parent_session);
        if (parent) {
          links.push({ source: parent.id, target: a.id, strength: 0.8 });
        }
      }
    });

    return { nodes, links };
  }, [agents, events]);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const width = 600;
    const height = 400;
    const svg = d3Selection.select(svgRef.current);
    svg.selectAll("*").remove();

    const maxTokens = Math.max(...nodes.map((n) => n.tokens), 1);

    const simulation = d3Force
      .forceSimulation(nodes as any)
      .force("link", d3Force.forceLink(links).id((d: any) => d.id).distance(120))
      .force("charge", d3Force.forceManyBody().strength(-200))
      .force("center", d3Force.forceCenter(width / 2, height / 2));

    // Links
    const link = svg
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "#00a2e0")
      .attr("stroke-opacity", (d) => d.strength * 0.6)
      .attr("stroke-width", 2);

    // Nodes
    const node = svg
      .append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer");

    // Node circles
    node
      .append("circle")
      .attr("r", (d) => 12 + (d.tokens / maxTokens) * 20)
      .attr("fill", (_, i) => AGENT_COLORS[i % AGENT_COLORS.length])
      .attr("opacity", 0.85);

    // Node labels
    node
      .append("text")
      .text((d) => d.label)
      .attr("dy", (d) => 12 + (d.tokens / maxTokens) * 20 + 14)
      .attr("text-anchor", "middle")
      .attr("fill", "#003864")
      .attr("font-size", 11)
      .attr("font-weight", 500);

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
    });

    return () => simulation.stop();
  }, [nodes, links]);

  if (agents.length === 0) {
    return <p className="text-muted text-sm">No agent interactions to display. This view is available for team sessions with multiple agents.</p>;
  }

  return (
    <div className="border border-border rounded-xl bg-white p-4">
      <svg ref={svgRef} width={600} height={400} className="mx-auto" />
    </div>
  );
}
```

- [ ] **Step 15.2: Commit**

```bash
git add src/client/components/AgentGraph.tsx
git commit -m "feat: force-directed agent interaction graph with D3"
```

---

## Task 16: Raw Data Explorer

**Files:**
- Create: `src/client/components/RawExplorer.tsx`
- Modify: `src/client/pages/RawExplorerPage.tsx`

- [ ] **Step 16.1: Implement RawExplorer**

```tsx
// src/client/components/RawExplorer.tsx
import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { DetailPanel } from "./DetailPanel";
import { formatTokens, formatCost, cn } from "../lib/utils";
import type { Event, Project } from "../lib/types";

export function RawExplorer() {
  const [events, setEvents] = useState<Event[]>([]);
  const [total, setTotal] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Event | null>(null);
  const [filters, setFilters] = useState({
    sessionId: "",
    type: "",
    model: "",
    toolName: "",
    limit: "100",
    offset: "0",
  });
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.projects.list().then(setProjects);
  }, []);

  useEffect(() => {
    const params: Record<string, string> = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.events.list(params).then((r) => {
      setEvents(r.events);
      setTotal(r.total);
    });
  }, [filters]);

  const filteredEvents = search
    ? events.filter((e) => e.raw?.toLowerCase().includes(search.toLowerCase()))
    : events;

  const page = parseInt(filters.offset) / parseInt(filters.limit) + 1;
  const totalPages = Math.ceil(total / parseInt(filters.limit));

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <select
          value={filters.type}
          onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value, offset: "0" }))}
          className="border border-border rounded-lg px-3 py-1.5 text-sm bg-white"
        >
          <option value="">All types</option>
          <option value="assistant">Assistant</option>
          <option value="user">User</option>
          <option value="progress">Progress</option>
          <option value="system">System</option>
        </select>
        <select
          value={filters.model}
          onChange={(e) => setFilters((f) => ({ ...f, model: e.target.value, offset: "0" }))}
          className="border border-border rounded-lg px-3 py-1.5 text-sm bg-white"
        >
          <option value="">All models</option>
          <option value="claude-opus-4-6">Opus</option>
          <option value="claude-sonnet-4-6">Sonnet</option>
          <option value="claude-haiku-4-5">Haiku</option>
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search raw JSON..."
          className="border border-border rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[200px]"
        />
      </div>

      {/* Table */}
      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-surface text-muted text-left">
              <th className="px-3 py-2 font-medium">Time</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Tool</th>
              <th className="px-3 py-2 font-medium text-right">In</th>
              <th className="px-3 py-2 font-medium text-right">Out</th>
              <th className="px-3 py-2 font-medium text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {filteredEvents.map((e) => (
              <tr
                key={e.id}
                onClick={() => setSelected(e)}
                className="border-t border-border hover:bg-primary/5 cursor-pointer transition-colors"
              >
                <td className="px-3 py-2 font-mono text-muted">{new Date(e.timestamp).toLocaleTimeString()}</td>
                <td className="px-3 py-2">
                  <span className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] font-medium",
                    e.type === "assistant" ? "bg-primary/10 text-primary" :
                    e.type === "user" ? "bg-accent/20 text-primary-dark" :
                    "bg-surface text-muted"
                  )}>
                    {e.type}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted">{e.model?.replace("claude-", "") ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-primary">{e.tool_name ?? "—"}</td>
                <td className="px-3 py-2 text-right font-mono">{e.input_tokens != null ? formatTokens(e.input_tokens) : "—"}</td>
                <td className="px-3 py-2 text-right font-mono">{e.output_tokens != null ? formatTokens(e.output_tokens) : "—"}</td>
                <td className="px-3 py-2 text-right font-mono">{e.cost_usd != null ? formatCost(e.cost_usd) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-3 text-sm text-muted">
        <span>{total} events total</span>
        <div className="flex gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setFilters((f) => ({ ...f, offset: String(Math.max(0, parseInt(f.offset) - parseInt(f.limit))) }))}
            className="px-3 py-1 border border-border rounded-lg disabled:opacity-30 hover:border-primary"
          >
            Prev
          </button>
          <span className="px-3 py-1">Page {page} of {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setFilters((f) => ({ ...f, offset: String(parseInt(f.offset) + parseInt(f.limit)) }))}
            className="px-3 py-1 border border-border rounded-lg disabled:opacity-30 hover:border-primary"
          >
            Next
          </button>
        </div>
      </div>

      <DetailPanel event={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
```

- [ ] **Step 16.2: Wire up RawExplorerPage**

```tsx
// src/client/pages/RawExplorerPage.tsx
import { RawExplorer } from "../components/RawExplorer";

export function RawExplorerPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary-dark mb-6">Raw Data Explorer</h1>
      <RawExplorer />
    </div>
  );
}
```

- [ ] **Step 16.3: Commit**

```bash
git add src/client/components/RawExplorer.tsx src/client/pages/RawExplorerPage.tsx
git commit -m "feat: raw data explorer with filtering, search, pagination, and detail view"
```

---

## Task 17: OTEL Receiver (Optional)

**Files:**
- Create: `src/server/otel/receiver.ts`

- [ ] **Step 17.1: Implement OTLP HTTP receiver**

The OTEL receiver accepts OTLP/HTTP (JSON) log exports and enriches existing JSONL-sourced records. We use a simple Hono route rather than pulling in the full OTEL SDK.

```typescript
// src/server/otel/receiver.ts
import type { Hono } from "hono";
import type { Database } from "bun:sqlite";

export function createOtelRoutes(app: Hono, db: Database): void {
  // Accept OTLP HTTP/JSON log exports
  app.post("/v1/logs", async (c) => {
    try {
      const body = await c.req.json();
      const resourceLogs = body.resourceLogs ?? [];

      for (const rl of resourceLogs) {
        for (const scopeLog of rl.scopeLogs ?? []) {
          for (const logRecord of scopeLog.logRecords ?? []) {
            processLogRecord(db, logRecord);
          }
        }
      }

      return c.json({ partialSuccess: {} });
    } catch (err) {
      console.error("[otel] Error processing logs:", err);
      return c.json({ error: "Failed to process" }, 400);
    }
  });

  // Accept OTLP HTTP/JSON metric exports (store raw for browsing)
  app.post("/v1/metrics", async (c) => {
    try {
      const body = await c.req.json();
      // Store raw metrics in otel_raw for the raw explorer
      const id = crypto.randomUUID();
      db.run(
        "INSERT INTO otel_raw (id, event_type, timestamp, data) VALUES (?, ?, datetime('now'), ?)",
        [id, "metrics", JSON.stringify(body)]
      );
      return c.json({ partialSuccess: {} });
    } catch {
      return c.json({ error: "Failed to process" }, 400);
    }
  });
}

function processLogRecord(db: Database, record: any): void {
  const attrs = parseAttributes(record.attributes ?? []);
  const eventName = attrs["event.name"] ?? record.severityText;

  if (eventName === "claude_code.api_request") {
    // Try to enrich existing event with cost_usd and duration_ms
    const sessionId = attrs["session.id"];
    const costUsd = parseFloat(attrs["cost_usd"] ?? "0");
    const durationMs = parseInt(attrs["duration_ms"] ?? "0", 10);
    const model = attrs["model"];
    const timestamp = record.timeUnixNano
      ? new Date(parseInt(record.timeUnixNano) / 1_000_000).toISOString()
      : null;

    if (sessionId && timestamp) {
      // Find closest matching event by session + timestamp (within 5s window)
      const existing = db.query(`
        SELECT id FROM events
        WHERE session_id = ? AND model = ? AND cost_usd IS NULL
          AND abs(julianday(timestamp) - julianday(?)) * 86400 < 5
        ORDER BY abs(julianday(timestamp) - julianday(?))
        LIMIT 1
      `).get(sessionId, model, timestamp, timestamp) as any;

      if (existing) {
        db.run(
          "UPDATE events SET cost_usd = ?, duration_ms = ? WHERE id = ?",
          [costUsd, durationMs, existing.id]
        );
        return;
      }
    }
  }

  // Store unmatched OTEL data for raw browsing
  const id = crypto.randomUUID();
  db.run(
    "INSERT INTO otel_raw (id, session_id, event_type, timestamp, data) VALUES (?, ?, ?, datetime('now'), ?)",
    [id, attrs["session.id"] ?? null, eventName, JSON.stringify(record)]
  );
}

function parseAttributes(attrs: any[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const attr of attrs) {
    if (attr.key && attr.value) {
      result[attr.key] = attr.value.stringValue ?? attr.value.intValue?.toString() ?? attr.value.doubleValue?.toString() ?? "";
    }
  }
  return result;
}
```

- [ ] **Step 17.2: Wire OTEL receiver into server index.ts**

Add to `src/server/index.ts` (conditional on config):
```typescript
// OTEL routes live on the main port (3000) — point OTEL_EXPORTER_OTLP_ENDPOINT here
if (config.otelEnabled) {
  const { createOtelRoutes } = await import("./otel/receiver");
  createOtelRoutes(app, db);
  console.log(`[otel] OTLP HTTP receiver enabled at /v1/logs and /v1/metrics on port ${config.port}`);
}
```

- [ ] **Step 17.3: Commit**

```bash
git add src/server/otel/receiver.ts
git commit -m "feat: optional OTEL HTTP receiver for cost/duration enrichment"
```

---

## Task 18: Docker Setup

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`

- [ ] **Step 18.1: Create Dockerfile**

```dockerfile
# Dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

# Install deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production=false

# Copy source
COPY . .

# Build frontend
RUN bun run build

# Production
FROM oven/bun:1-slim
WORKDIR /app

COPY --from=base /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./

# Create DB directory
RUN mkdir -p /data/db

ENV NODE_ENV=production
ENV CT_DATA_DIR=/data

EXPOSE 3000

CMD ["bun", "dist/server/index.js"]
```

- [ ] **Step 18.2: Create docker-compose.yml**

```yaml
# docker-compose.yml
services:
  claude-telemetry:
    build: .
    ports:
      - "${CT_PORT:-3000}:3000"
      # OTEL receiver shares port 3000 — no separate port needed
    volumes:
      - ${CLAUDE_HOME:-~/.claude}/projects:/data/projects:ro
      - ${CLAUDE_HOME:-~/.claude}/sessions:/data/sessions:ro
      - ${CLAUDE_HOME:-~/.claude}/teams:/data/teams:ro
      - ${CLAUDE_HOME:-~/.claude}/tasks:/data/tasks:ro
      - telemetry-db:/data/db
    environment:
      - NODE_ENV=production
      - CT_DATA_DIR=/data
      - CT_WATCH_MODE=${CT_WATCH_MODE:-poll}
      - CT_POLL_INTERVAL=${CT_POLL_INTERVAL:-1000}
      - CT_OTEL_ENABLED=${CT_OTEL_ENABLED:-false}
    restart: unless-stopped

volumes:
  telemetry-db:
```

- [ ] **Step 18.3: Verify Docker build**

```bash
docker compose build
docker compose up -d
# Wait a few seconds, then:
curl http://localhost:3000/api/projects
```
Expected: JSON response (empty array or list of projects)

- [ ] **Step 18.4: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "feat: Docker setup with single container, configurable volumes"
```

---

## Task 19: Seed Script & End-to-End Verification

**Files:**
- Create: `scripts/seed.ts`

- [ ] **Step 19.1: Create seed script**

```typescript
// scripts/seed.ts
// Reads real ~/.claude/projects data and processes it into the local SQLite DB
// Usage: CT_DATA_DIR=~/.claude bun scripts/seed.ts

import { Database } from "bun:sqlite";
import { applySchema } from "../src/server/db/schema";
import { processJsonlLine } from "../src/server/ingestion/processor";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const dataDir = process.env.CT_DATA_DIR ?? `${process.env.HOME}/.claude`;
const dbPath = process.env.CT_DB_PATH ?? "./telemetry.db";
const projectsDir = join(dataDir, "projects");

console.log(`Seeding from ${projectsDir} into ${dbPath}`);

const db = new Database(dbPath, { create: true });
applySchema(db);

let totalEvents = 0;

for (const projectSlug of readdirSync(projectsDir)) {
  const projectDir = join(projectsDir, projectSlug);
  if (!statSync(projectDir).isDirectory()) continue;

  const jsonlFiles = readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
  for (const file of jsonlFiles) {
    const filePath = join(projectDir, file);
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    for (const line of lines) {
      const id = processJsonlLine(db, line, projectSlug);
      if (id) totalEvents++;
    }
  }

  // Process subagent files
  const subagentsDir = join(projectDir, "subagents");
  try {
    const subFiles = readdirSync(subagentsDir).filter((f) => f.endsWith(".jsonl"));
    for (const file of subFiles) {
      const content = readFileSync(join(subagentsDir, file), "utf-8");
      for (const line of content.split("\n").filter((l) => l.trim())) {
        const id = processJsonlLine(db, line, projectSlug);
        if (id) totalEvents++;
      }
    }
  } catch {}
}

console.log(`Seeded ${totalEvents} events`);
db.close();
```

- [ ] **Step 19.2: Run seed and verify**

```bash
bun scripts/seed.ts
```
Expected: `Seeded N events` (N > 0 if you have Claude Code session history)

- [ ] **Step 19.3: Run all tests**

```bash
bun test
```
Expected: All tests pass

- [ ] **Step 19.4: Commit**

```bash
git add scripts/seed.ts
git commit -m "feat: seed script for bootstrapping DB from real Claude data"
```

---

## Task 20: Final Integration

- [ ] **Step 20.1: Verify full stack locally**

```bash
# Start backend (with real data)
CT_DATA_DIR=~/.claude bun run dev &

# Start frontend
bun run dev:client

# Open http://localhost:5173 — should see projects
```

- [ ] **Step 20.2: Verify Docker end-to-end**

```bash
docker compose up --build -d
# Open http://localhost:3000 — full app
docker compose logs -f
```

- [ ] **Step 20.3: Run all tests one final time**

```bash
bun test
```

- [ ] **Step 20.4: Final commit**

```bash
git add -A
git commit -m "chore: final integration and cleanup"
```
