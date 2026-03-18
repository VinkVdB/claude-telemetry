# High-Level Application Overview

## Application Name
**Claude Telemetry Dashboard** — a lightweight, local-first monitoring tool for Claude Code usage.

## Goal
Track everything per project (directory name): sessions, agent actions, token usage, costs, and timing — presented as both a list view and a Jaeger-like trace view.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Docker Container                      │
│                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────┐  │
│  │  File Watcher│    │  OTEL        │    │  SQLite   │  │
│  │  (chokidar)  │───▶│  Enrichment  │───▶│  (JSON    │  │
│  │              │    │  (optional)  │    │  columns) │  │
│  └──────┬───────┘    └──────┬───────┘    └─────┬─────┘  │
│         │                   │                  │        │
│    Watches:                OTLP              Queries    │
│    ~/.claude/projects/     receiver                     │
│    ~/.claude/sessions/     (port 4317)                  │
│    ~/.claude/teams/                                     │
│         │                                    │          │
│  ┌──────▼────────────────────────────────────▼───────┐  │
│  │              Backend API (single process)         │  │
│  │              Node.js / Bun                        │  │
│  │                                                   │  │
│  │  - REST API for dashboard queries                 │  │
│  │  - SSE endpoint for real-time updates             │  │
│  │  - JSONL parser + ingestion pipeline              │  │
│  │  - OTEL data receiver (optional enrichment)       │  │
│  │  - Cost calculator (model pricing table)          │  │
│  │                                                   │  │
│  └──────────────────────┬────────────────────────────┘  │
│                         │                               │
│  ┌──────────────────────▼────────────────────────────┐  │
│  │              Frontend (SPA)                       │  │
│  │              React + Vite                         │  │
│  │                                                   │  │
│  │  - Project overview (per-directory grouping)      │  │
│  │  - Session list + detail views                    │  │
│  │  - Agent list view (per-agent action timeline)    │  │
│  │  - Trace view (Jaeger-like span visualization)    │  │
│  │  - Agent interaction graph (animated nodes)       │  │
│  │  - Raw data explorer (dynamic table/filters)      │  │
│  │  - Real-time updates via SSE                      │  │
│  │                                                   │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  Single exposed port: 3000 (serves both API + SPA)      │
│                                                         │
└─────────────────────────────────────────────────────────┘

Mounted volumes (read-only):
  - ~/.claude/projects/    → session JSONL files
  - ~/.claude/sessions/    → active session PIDs
  - ~/.claude/teams/       → team configs + inboxes
  - ~/.claude/tasks/       → task tracking
```

---

## Data Flow

### Primary: Filesystem Watching (always active)
1. **Watcher** monitors `~/.claude/projects/` for new/changed `.jsonl` files
2. New lines are parsed, classified (assistant/user/progress/system), and stored in SQLite
3. Assistant messages extract: model, tokens, tool calls, thinking, stop_reason
4. User messages extract: prompts, tool results
5. Subagent files (`subagents/agent-*.jsonl`) are linked to parent sessions
6. **SSE broadcast** pushes new events to connected frontends in real-time

### Secondary: OTEL Enrichment (optional)
1. Lightweight OTLP receiver listens on port 4317 (gRPC) inside the container
2. Incoming `claude_code.api_request` events are matched to JSONL records via `session_id` + `event.sequence` / timestamp proximity
3. Matched records are enriched with `cost_usd` and `duration_ms`
4. If no OTEL data: cost is computed from `tokens × model_pricing`, duration inferred from message timestamps

### Deduplication Rules
- JSONL records are the **canonical source** — keyed by `(sessionId, uuid)`
- OTEL events are **enrichment-only** — never create standalone records
- On match: merge OTEL fields into existing record
- On no match: OTEL data stored in a separate `otel_unmatched` table for raw browsing

---

## Data Model (SQLite with JSON columns)

### Core Tables

```sql
-- Projects derived from directory slugs
projects (
  id          TEXT PRIMARY KEY,   -- slug e.g. "-Users-vinkvdb-Documents-Projects-..."
  name        TEXT,               -- extracted directory name e.g. "claude-telemetry"
  path        TEXT,               -- full path
  last_active DATETIME
)

-- Sessions within projects
sessions (
  id              TEXT PRIMARY KEY,   -- Claude session UUID
  project_id      TEXT REFERENCES projects,
  git_branch      TEXT,
  started_at      DATETIME,
  ended_at        DATETIME,
  slug            TEXT,               -- human-readable session name
  total_tokens    INTEGER,            -- aggregated
  total_cost_usd  REAL,              -- aggregated (computed or from OTEL)
  models_used     TEXT                -- JSON array of model names
)

-- Every message/event in a session
events (
  id              TEXT PRIMARY KEY,   -- message UUID
  session_id      TEXT REFERENCES sessions,
  parent_id       TEXT,               -- parentUuid for conversation tree
  type            TEXT,               -- assistant/user/progress/system
  timestamp       DATETIME,
  model           TEXT,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  cache_read_tokens INTEGER,
  cache_creation_tokens INTEGER,
  cost_usd        REAL,              -- from OTEL or computed
  duration_ms     INTEGER,           -- from OTEL or inferred
  tool_name       TEXT,              -- if tool_use
  stop_reason     TEXT,
  content         TEXT,              -- JSON blob of full message content
  raw             TEXT               -- full original JSONL line (for raw explorer)
)

-- Agent/subagent tracking
agents (
  id              TEXT PRIMARY KEY,   -- agentId
  session_id      TEXT REFERENCES sessions,
  parent_session  TEXT,               -- lead agent's session
  agent_type      TEXT,               -- general-purpose, Explore, Plan, etc.
  started_at      DATETIME,
  ended_at        DATETIME,
  description     TEXT
)

-- OTEL data that didn't match any JSONL record
otel_raw (
  id              TEXT PRIMARY KEY,
  session_id      TEXT,
  event_type      TEXT,
  timestamp       DATETIME,
  data            TEXT               -- full JSON payload
)
```

---

## Frontend Views

### 1. Project Overview (home page)
- Card grid of all projects (derived from directory names)
- Each card shows: project name, last active, session count, total cost, top models used
- Click → project detail

### 2. Session List (per project)
- Sortable/filterable table: session name, date, duration, token count, cost, models, agent count
- Status indicator (active/completed)
- Click → session detail

### 3. Agent List View (per session)
- Vertical list of all agents (main + subagents)
- Per agent: type badge, description, timeline of actions, token usage, cost
- Expandable rows showing individual tool calls with inputs/outputs
- Click any action → detail panel

### 4. Trace View (Jaeger-style, per session)
- Horizontal timeline with swim lanes per agent (color-coded)
- Spans represent: API calls, tool executions, thinking blocks
- Span width = duration (from OTEL `duration_ms` or inferred)
- Click span → slide-out detail panel: tokens, cost, tool I/O, model, thinking content
- Zoom/pan controls

### 5. Agent Interaction Graph (per team session)
- Force-directed graph: nodes = agents, edges = message exchanges
- Edges glow on recent activity, fade over time
- Node size = relative token usage
- Animated: new connections light up, old ones dim
- Click node → agent detail

### 6. Raw Data Explorer
- Dynamic table with all events across sessions
- Column picker, filters (by project, session, agent, type, model, date range)
- Full-text search across raw JSON
- Export to CSV/JSON
- Click row → formatted JSON viewer

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | **Bun** | Fast, built-in SQLite, TypeScript native, single binary |
| Backend | **Hono** | Lightweight, fast, works great with Bun, SSE support |
| Database | **SQLite** (via `bun:sqlite`) | Zero dependency, single file, JSON support, perfect for local tool |
| Frontend | **React 19 + Vite** | Fast dev, modern, large ecosystem |
| Styling | **Tailwind CSS** | Utility-first, responsive, matches clean/modern requirement |
| UI Components | **shadcn/ui** | Polished, accessible, light themed with blue accents |
| Trace Visualization | **Custom SVG** | Lightweight, no heavy dependency, full control over Jaeger-like view |
| Graph Visualization | **D3-force** | De facto standard for force-directed graphs, lightweight |
| Real-time | **Server-Sent Events** | Simple, one-direction push, native browser support |
| File Watching | **chokidar** (or Bun native) | Reliable cross-platform file watching |
| OTEL Receiver | **@opentelemetry/otlp-grpc-receiver** or custom | Lightweight gRPC listener for OTLP protocol |
| Container | **Docker** (single container) | One Dockerfile, one port, read-only volume mounts |

---

## Design Language

- **Light modern theme** with blue accent elements:
  - Primary: #00a2e0 (InfoSupport blue)
  - Secondary/Text: #003864 (InfoSupport dark blue)
  - Accent: #bdd72d (InfoSupport lime)
  - Background: #ffffff (light)
- InfoSupport brand alignment: clean, professional, blue-centric palette
- Subtle animations: fade-in on data load, smooth transitions between views
- SVG icons and visualizations throughout
- Responsive layout: works on laptop screens and wide monitors
- Typography: Inter or similar clean sans-serif

---

## Single Container, Single Port

Everything runs in one Docker container:
- Bun serves both the API and the built SPA on **port 3000**
- OTEL receiver (optional) on **port 4317** (only if OTEL enrichment is desired)
- SQLite database stored in a Docker volume for persistence
- `~/.claude/` subdirectories mounted as read-only volumes

```yaml
# docker-compose.yml (simplified)
services:
  claude-telemetry:
    build: .
    ports:
      - "3000:3000"    # Dashboard + API
      - "4317:4317"    # OTEL receiver (optional)
    volumes:
      - ~/.claude/projects:/data/projects:ro
      - ~/.claude/sessions:/data/sessions:ro
      - ~/.claude/teams:/data/teams:ro
      - ~/.claude/tasks:/data/tasks:ro
      - telemetry-db:/data/db
    environment:
      - NODE_ENV=production

volumes:
  telemetry-db:
```

---

## What's NOT in Scope (kept simple)

- No authentication (local tool, single user)
- No data retention policies (SQLite can be wiped/vacuumed manually)
- No multi-user support (each developer runs their own instance)
- No external ticket system integration (removed ADO coupling from claude-trace)
- No write operations to ~/.claude/ (strictly read-only)
