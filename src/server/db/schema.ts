// src/server/db/schema.ts
import { Database } from "bun:sqlite";
import { updateSessionAggregates } from "./queries";

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
      raw             TEXT,
      agent_id        TEXT
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

    CREATE TABLE IF NOT EXISTS settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id);
  `);

  // Migration: add agent_id column to existing DBs — must run before the index on agent_id
  try { db.exec("ALTER TABLE events ADD COLUMN agent_id TEXT"); } catch { /* column already exists */ }

  // Index on agent_id — created after migration so it works on both new and existing DBs
  db.exec("CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id)");

  // Migration: add message_id for proper per-message deduplication
  try { db.exec("ALTER TABLE events ADD COLUMN message_id TEXT"); } catch { /* column already exists */ }
  db.exec("CREATE INDEX IF NOT EXISTS idx_events_message_id ON events(message_id) WHERE message_id IS NOT NULL");

  // Migration: reset ingested data to fix token double-counting bug (duplicate JSONL lines per message.id)
  // Without this, one API response with text+tool_use produces 2+ events each with full token counts
  const dedupMigration = db.query("SELECT value FROM settings WHERE key = 'migration_message_id_dedup'").get() as any;
  if (!dedupMigration) {
    db.exec("DELETE FROM events");
    db.exec("DELETE FROM agents");
    db.exec("DELETE FROM otel_raw");
    db.exec("DELETE FROM sessions");
    db.exec("DELETE FROM projects");
    db.exec("DELETE FROM ingest_cursors");
    db.run(`INSERT INTO settings (key, value) VALUES ('migration_message_id_dedup', '1')
            ON CONFLICT(key) DO UPDATE SET value = '1'`);
  }

  // Migration: clean up any NULL-id sessions that slipped in before the guard was added
  db.exec("DELETE FROM sessions WHERE id IS NULL");

  // Migration: add otel_cost_usd column to events for OTEL-reported cost (separate from estimated cost_usd)
  try { db.exec("ALTER TABLE events ADD COLUMN otel_cost_usd REAL"); } catch { /* column already exists */ }

  // Migration: add chain_id to agents and events for logical agent grouping.
  // chain_id = UUID of the very first record in the transcript chain. All turn transcripts
  // of the same logical agent share this value. Stored on BOTH tables so listEvents can
  // filter by chain_id directly (indexed column lookup) without any subquery expansion.
  try { db.exec("ALTER TABLE agents ADD COLUMN chain_id TEXT"); } catch { /* already exists */ }
  try { db.exec("ALTER TABLE events ADD COLUMN chain_id TEXT"); } catch { /* already exists */ }
  db.exec("CREATE INDEX IF NOT EXISTS idx_agents_chain ON agents(chain_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_events_chain  ON events(chain_id)");

  // Backfill chain_id on existing events from their agent's chain_id — pure SQL, no file reads.
  // Runs once; agents without chain_id yet simply leave events.chain_id NULL (fallback to agent_id).
  const chainIdBackfill = db.query("SELECT value FROM settings WHERE key='migration_chain_id_events_backfill'").get();
  if (!chainIdBackfill) {
    db.exec(`
      UPDATE events
      SET chain_id = (SELECT chain_id FROM agents WHERE id = events.agent_id)
      WHERE agent_id IS NOT NULL AND chain_id IS NULL
    `);
    db.run(`INSERT INTO settings (key, value) VALUES ('migration_chain_id_events_backfill', '1')
            ON CONFLICT(key) DO UPDATE SET value='1'`);
  }

  // Session costs materialized aggregate table
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_costs (
      session_id            TEXT    NOT NULL,
      model                 TEXT    NOT NULL,
      input_tokens          INTEGER NOT NULL DEFAULT 0,
      output_tokens         INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      otel_cost_usd         REAL,
      otel_event_count      INTEGER NOT NULL DEFAULT 0,
      event_count           INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (session_id, model)
    );

    CREATE INDEX IF NOT EXISTS idx_session_costs_session ON session_costs(session_id);
  `);

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

  // Migration: backfill session_costs for existing events (one-time, guarded by flag)
  const sessionCostsBackfill = db.query("SELECT value FROM settings WHERE key='migration_session_costs_backfill'").get();
  if (!sessionCostsBackfill) {
    const sessions = db.query("SELECT DISTINCT session_id FROM events").all() as { session_id: string }[];
    for (const { session_id } of sessions) {
      updateSessionAggregates(db, session_id);
    }
    db.run(
      `INSERT INTO settings (key, value) VALUES ('migration_session_costs_backfill', '1')
       ON CONFLICT(key) DO UPDATE SET value='1'`
    );
  }

  // FTS backfill — run once on first startup after upgrade (guarded by migration flag)
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
}
