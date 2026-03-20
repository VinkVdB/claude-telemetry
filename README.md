# Claude Telemetry Dashboard

A lightweight, local-first monitoring dashboard for [Claude Code](https://claude.ai/claude-code) usage. Tracks sessions, agent actions, token usage, costs, and timing — per project.

![Dashboard showing project cards, session lists, and trace views]

## What it shows

- **Projects** — all directories you've used Claude Code in, with total cost and token counts
- **Sessions** — each conversation, with model breakdown, cost, and event timeline
- **Traces** — Jaeger-style span view of tool calls within a session
- **Agent graph** — D3 force graph of subagent relationships
- **Raw explorer** — filterable, searchable event log with full JSON drill-down
- **Settings** — configure model pricing, graph appearance, display preferences, and watcher behaviour from the UI

## How it works

The dashboard watches `~/.claude/projects/**/*.jsonl` — the append-only session logs that Claude Code writes automatically. No hooks, no SDK changes, no configuration needed on the Claude side.

Data is stored in a local SQLite database inside a named Docker volume, so it persists across container restarts.

## Running with Docker (recommended)

**Prerequisites:** Docker Desktop or [colima](https://github.com/abiosoft/colima)

```bash
# Clone and start
git clone <repo>
cd claude-telemetry
docker compose up -d

# Open the dashboard
open http://localhost:4242
```

The first startup ingests all existing session history from `~/.claude/`. New sessions appear in real time via SSE.

### Stopping

```bash
docker compose down        # stop (data is preserved in the volume)
docker compose down -v     # stop and delete all data
```

### Rebuilding after a code change

```bash
docker compose up -d --build
```

## Connecting Claude Code to the dashboard (optional OTEL enrichment)

By default the dashboard reads `cost_usd` and `duration_ms` from the JSONL files. For more precise numbers you can also forward Claude Code's OpenTelemetry spans:

1. Enable the OTEL receiver in `.env`:

   ```bash
   cp .env.example .env
   # edit .env: CT_OTEL_ENABLED=true
   ```

2. Point Claude Code at the receiver by adding to your `~/.claude/settings.json`:

   ```json
   {
     "env": {
       "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4242",
       "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf"
     }
   }
   ```

3. Restart the container: `docker compose up -d --build`

The receiver accepts OTLP/HTTP on the same port 4242 (paths `/v1/logs` and `/v1/metrics`).

## Running locally (dev mode)

Requires [Bun](https://bun.sh) ≥ 1.0.

```bash
bun install

# Terminal 1 — backend (hot reload)
bun run dev

# Terminal 2 — frontend (Vite dev server with HMR, proxies API to :3000)
bun run dev:client
```

Frontend is at http://localhost:5173, API at http://localhost:3000.

To pre-populate with your existing history:

```bash
bun scripts/seed.ts
```

## Configuration

Most settings are configurable live from the **Settings page** (`/settings`) without restarting the container. Changes are stored in the SQLite database and take effect immediately for display and pricing settings. Server-side watcher settings require a restart.

### Env var precedence

Environment variables always take precedence over database settings. Set an env var to lock a value regardless of what the Settings UI stores.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `CT_PORT` | `4242` | Host port (docker compose) |
| `CT_DATA_DIR` | `/data` | Data directory inside container |
| `CT_WATCH_MODE` | `auto` | `auto` \| `native` \| `poll` |
| `CT_POLL_INTERVAL` | `1000` | Polling interval in ms — overrides `server.pollInterval` DB setting |
| `CT_OTEL_ENABLED` | `false` | Enable OTEL HTTP receiver |
| `CLAUDE_HOME` | `~/.claude` | Host path to Claude data |

### Settings page tabs

| Tab | What you can configure |
|---|---|
| **Model Pricing** | USD per 1M tokens per model. Add custom models or adjust rates. |
| **Agent Graph** | Node/link colors, force simulation parameters, link thickness and opacity. |
| **Server** | File watcher poll interval and stability thresholds (requires restart). |
| **Display** | Event buffer size, jump step, cost/token formatting, time display, trace layout. |

## VS Code tasks

Open the Command Palette → **Tasks: Run Task**:

| Task | What it does |
|---|---|
| **Docker: Start (build)** | `docker compose up --build -d` |
| **Docker: Stop** | `docker compose down` |
| **Docker: Logs** | `docker compose logs -f` |
| **Dev: Start backend** | `bun run dev` |
| **Dev: Start frontend (Vite)** | `bun run dev:client` |
| **Test: Run all tests** | `bun test` |
| **Test: Watch** | `bun test --watch` |
| **Seed DB from ~/.claude** | `bun scripts/seed.ts` |

## Tech stack

- **Runtime:** Bun + TypeScript
- **Backend:** Hono, SQLite (`bun:sqlite`), chokidar
- **Frontend:** React 19, Vite, Tailwind CSS v4, D3-force
- **Container:** Single Docker container, named volume for DB
