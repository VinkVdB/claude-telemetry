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
