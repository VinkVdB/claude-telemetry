# CLAUDE.md

## Overview

Claude Telemetry Dashboard — a lightweight, local-first Docker-based monitoring tool for Claude Code usage. Tracks sessions, agent actions, token usage, costs, and timing per project directory.

## Architecture

- **Single Docker container**: Bun + Hono backend, React + Vite frontend, SQLite database
- **Primary data source**: Filesystem watching of `~/.claude/projects/**/*.jsonl` via chokidar
- **Optional enrichment**: OTEL HTTP receiver on same port for `cost_usd` and `duration_ms`
- **Real-time**: SSE pushes new events to connected browsers
- **Single port**: 3000 serves API, SPA, and OTEL receiver

## Tech Stack

- **Runtime**: Bun (built-in SQLite, TypeScript native)
- **Backend**: Hono (lightweight, SSE support)
- **Database**: SQLite via `bun:sqlite` with JSON columns
- **Frontend**: React 19 + Vite + Tailwind CSS v4 (no config file — uses `@tailwindcss/vite`)
- **Visualization**: Custom SVG for traces, D3-force for agent graph
- **File watching**: chokidar (cross-platform, polling fallback for Docker)

## Design Tokens (InfoSupport Brand)

- Primary: `#00a2e0`
- Dark/Text: `#003864`
- Accent: `#bdd72d`
- Background: `#ffffff`
- Font: Inter

## Key Conventions

- **Tailwind v4**: No `tailwind.config.ts` or `postcss.config.js` — config lives in `src/client/styles/globals.css` using `@theme` block
- **No shadcn/ui**: Pure Tailwind utility classes
- **JSONL parsing**: Parser in `src/server/ingestion/parser.ts` — all types defined there
- **Cost calculation**: Pricing table in `src/server/ingestion/pricing.ts` — computed from tokens × model rates
- **Deduplication**: Events keyed by `(sessionId, uuid)` with `INSERT OR IGNORE`; OTEL only enriches existing records
- **Cursor tracking**: `ingest_cursors` table stores byte offsets per file for incremental ingestion
- **Cross-platform watcher**: Uses `Bun.file().slice(offset).text()` for byte-accurate reads

## Project Structure

```
src/server/          — Backend (Hono API, ingestion pipeline, SSE, optional OTEL)
src/client/          — Frontend (React SPA, pages, components)
test/server/         — Backend tests (bun:test)
test/fixtures/       — Sample JSONL data for tests
scripts/             — Seed script for bootstrapping DB
docs/                — High-level overview, data source research, implementation plan
```

## Commands

```bash
bun install           # Install dependencies
bun test              # Run all tests
bun run dev           # Start backend (hot reload)
bun run dev:client    # Start Vite dev server (proxies API to :3000)
bun run build         # Build frontend + backend for production
bun scripts/seed.ts   # Seed DB from real ~/.claude data
docker compose up -d  # Run in Docker
```

## Implementation Plan

Follow `docs/superpowers/plans/2026-03-18-claude-telemetry-dashboard.md` — 20 tasks with TDD steps. Execute tasks in order; each task has exact file paths, test commands, and commit instructions.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CT_DATA_DIR` | `/data` | Base data directory (inside container) |
| `CT_PORT` | `3000` | Server port |
| `CT_WATCH_MODE` | `auto` | `auto`, `native`, or `poll` |
| `CT_POLL_INTERVAL` | `1000` | Polling interval in ms |
| `CT_OTEL_ENABLED` | `false` | Enable OTEL HTTP receiver |
| `CLAUDE_HOME` | `~/.claude` | Host path for Docker volume mounts |
