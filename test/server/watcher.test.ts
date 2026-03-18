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
