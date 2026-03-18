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
