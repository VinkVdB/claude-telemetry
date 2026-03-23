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
    expect(event.cost_usd).toBeNull();
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

  test("updates existing event when new event has higher token count for same message_id", () => {
    const base = {
      sessionId: "sess-abc",
      cwd: "/Users/dev/my-project",
      type: "assistant",
      message: {
        model: "claude-sonnet-4-6",
        role: "assistant",
        stop_reason: "end_turn",
      },
    };
    // First event: lower token count
    const line1 = JSON.stringify({
      ...base,
      uuid: "msg-first",
      timestamp: "2026-03-18T10:00:00.000Z",
      message: {
        ...base.message,
        id: "api-msg-xyz",
        content: [{ type: "text", text: "partial" }],
        usage: { input_tokens: 100, output_tokens: 20 },
      },
    });
    // Second event: same message_id, higher token count
    const line2 = JSON.stringify({
      ...base,
      uuid: "msg-second",
      timestamp: "2026-03-18T10:00:01.000Z",
      message: {
        ...base.message,
        id: "api-msg-xyz",
        content: [{ type: "text", text: "full" }, { type: "tool_use", id: "t1", name: "bash", input: {} }],
        usage: { input_tokens: 150, output_tokens: 80 },
      },
    });

    processJsonlLine(db, line1, "-Users-dev-my-project");
    processJsonlLine(db, line2, "-Users-dev-my-project");

    // Should still be exactly one event row
    const count = db.query("SELECT COUNT(*) as c FROM events").get() as any;
    expect(count.c).toBe(1);

    // The row should have the higher token values
    const event = db.query("SELECT * FROM events WHERE message_id = 'api-msg-xyz'").get() as any;
    expect(event).not.toBeNull();
    expect(event.input_tokens).toBe(150);
    expect(event.output_tokens).toBe(80);
  });

  test("preserves original event UUID when deduplicating", () => {
    const base = {
      sessionId: "sess-abc",
      cwd: "/Users/dev/my-project",
      type: "assistant",
      message: {
        model: "claude-sonnet-4-6",
        role: "assistant",
        stop_reason: "end_turn",
      },
    };
    const line1 = JSON.stringify({
      ...base,
      uuid: "uuid-original",
      timestamp: "2026-03-18T10:00:00.000Z",
      message: {
        ...base.message,
        id: "api-msg-preserve",
        content: [{ type: "text", text: "partial" }],
        usage: { input_tokens: 100, output_tokens: 20 },
      },
    });
    const line2 = JSON.stringify({
      ...base,
      uuid: "uuid-newer",
      timestamp: "2026-03-18T10:00:01.000Z",
      message: {
        ...base.message,
        id: "api-msg-preserve",
        content: [{ type: "text", text: "full" }],
        usage: { input_tokens: 200, output_tokens: 50 },
      },
    });

    processJsonlLine(db, line1, "-Users-dev-my-project");
    processJsonlLine(db, line2, "-Users-dev-my-project");

    // The original UUID must be preserved — UPDATE in-place, not delete+insert
    const event = db.query("SELECT * FROM events WHERE id = 'uuid-original'").get() as any;
    expect(event).not.toBeNull();
    expect(event.input_tokens).toBe(200);

    // The newer UUID must NOT exist as a separate row
    const newer = db.query("SELECT * FROM events WHERE id = 'uuid-newer'").get() as any;
    expect(newer).toBeNull();
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
