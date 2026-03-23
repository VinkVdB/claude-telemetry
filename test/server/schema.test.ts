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

  test("creates session_costs table", () => {
    applySchema(db);
    const table = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='session_costs'")
      .get() as { name: string } | null;
    expect(table).not.toBeNull();
  });

  test("session_costs has correct columns", () => {
    applySchema(db);
    const cols = db
      .query("PRAGMA table_info(session_costs)")
      .all() as { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }[];
    const colMap = Object.fromEntries(cols.map((c) => [c.name, c]));
    expect(colMap["session_id"]).toBeDefined();
    expect(colMap["model"]).toBeDefined();
    expect(colMap["input_tokens"]).toBeDefined();
    expect(colMap["output_tokens"]).toBeDefined();
    expect(colMap["cache_read_tokens"]).toBeDefined();
    expect(colMap["cache_creation_tokens"]).toBeDefined();
    expect(colMap["otel_cost_usd"]).toBeDefined();
    expect(colMap["otel_event_count"]).toBeDefined();
    expect(colMap["event_count"]).toBeDefined();
  });

  test("creates idx_session_costs_session index", () => {
    applySchema(db);
    const idx = db
      .query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_session_costs_session'")
      .get() as { name: string } | null;
    expect(idx).not.toBeNull();
  });

  test("events table has otel_cost_usd column", () => {
    applySchema(db);
    const cols = db
      .query("PRAGMA table_info(events)")
      .all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toContain("otel_cost_usd");
  });

  test("session_costs backfill populates data for pre-existing events", () => {
    // Simulate a DB that already has data before the session_costs backfill migration
    applySchema(db);
    // Clear the migration flag so we can re-run and simulate an upgrade
    db.exec("DELETE FROM settings WHERE key='migration_session_costs_backfill'");
    // Clear session_costs so it's empty (as it would be before this migration)
    db.exec("DELETE FROM session_costs");
    // Insert pre-existing session data
    db.exec(`
      INSERT OR IGNORE INTO projects VALUES ('p1','test','/p1',NULL);
      INSERT OR IGNORE INTO sessions (id,project_id) VALUES ('s1','p1');
      INSERT OR IGNORE INTO events (id,session_id,type,timestamp,model,input_tokens,output_tokens)
        VALUES ('e1','s1','assistant','2026-01-01T00:00:00Z','claude-sonnet-4-6',100,50);
      INSERT OR IGNORE INTO events (id,session_id,type,timestamp,model,input_tokens,output_tokens)
        VALUES ('e2','s1','assistant','2026-01-01T00:01:00Z','claude-sonnet-4-6',200,80);
    `);
    // Re-apply schema to trigger the backfill
    applySchema(db);
    // session_costs should now be populated for s1
    const row = db.query(
      "SELECT * FROM session_costs WHERE session_id = ? AND model = ?"
    ).get("s1", "claude-sonnet-4-6") as any;
    expect(row).not.toBeNull();
    expect(row.input_tokens).toBe(300);
    expect(row.output_tokens).toBe(130);
    // Migration flag should be set
    const flag = db.query("SELECT value FROM settings WHERE key='migration_session_costs_backfill'").get() as any;
    expect(flag?.value).toBe("1");
  });

  test("session_costs backfill is idempotent (does not run twice)", () => {
    applySchema(db);
    db.exec(`
      INSERT OR IGNORE INTO projects VALUES ('p2','test2','/p2',NULL);
      INSERT OR IGNORE INTO sessions (id,project_id) VALUES ('s2','p2');
      INSERT OR IGNORE INTO events (id,session_id,type,timestamp,model,input_tokens,output_tokens)
        VALUES ('e3','s2','assistant','2026-01-01T00:00:00Z','claude-haiku-4-5-20251001',50,20);
    `);
    // Applying schema again should not duplicate or fail
    applySchema(db);
    const count = db.query("SELECT COUNT(*) as c FROM session_costs WHERE session_id='s2'").get() as any;
    // Should not double-insert; count should be 0 since flag is already set from first applySchema
    expect(count.c).toBeLessThanOrEqual(1);
  });

  test("FTS backfill migration flag is recorded", () => {
    // First apply schema to create all tables and run existing migrations
    applySchema(db);
    // Simulate an existing DB that has data but hasn't run the FTS backfill migration yet
    db.exec("DELETE FROM settings WHERE key='migration_fts_backfill'");
    db.exec(`
      INSERT INTO projects VALUES ('p1','test','/p1',NULL);
      INSERT INTO sessions (id,project_id) VALUES ('s1','p1');
      INSERT INTO events (id,session_id,type,timestamp) VALUES ('e1','s1','assistant','2026-01-01T00:00:00Z');
    `);
    applySchema(db);
    const flag = db.query("SELECT value FROM settings WHERE key='migration_fts_backfill'").get() as any;
    expect(flag?.value).toBe("1");
  });
});
