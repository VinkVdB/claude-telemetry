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
