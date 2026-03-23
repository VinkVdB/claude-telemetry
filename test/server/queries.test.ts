// test/server/queries.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/server/db/schema";
import { listEvents, listAgentSummaries } from "../../src/server/db/queries";
import { processJsonlLine } from "../../src/server/ingestion/processor";

function seedEvent(db: Database, opts: {
  uuid: string; sessionId: string; type?: string; model?: string;
  agentId?: string; raw?: string;
}) {
  const line = JSON.stringify({
    uuid: opts.uuid,
    type: opts.type ?? "assistant",
    timestamp: "2026-01-01T00:00:00.000Z",
    sessionId: opts.sessionId,
    cwd: "/test/project",
    message: {
      model: opts.model ?? "claude-sonnet-4-6",
      role: "assistant",
      content: [{ type: "text", text: opts.raw ?? "hello" }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
    ...(opts.agentId ? { isSidechain: true, agentId: opts.agentId } : {}),
  });
  processJsonlLine(db, line, "-test-project");
}

describe("listEvents", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    seedEvent(db, { uuid: "e1", sessionId: "s1", type: "assistant", model: "claude-sonnet-4-6" });
    seedEvent(db, { uuid: "e2", sessionId: "s1", type: "user", model: "claude-sonnet-4-6" });
    seedEvent(db, { uuid: "e3", sessionId: "s1", type: "assistant", model: "claude-haiku-4-5", agentId: "agent-A" });
    seedEvent(db, { uuid: "e4", sessionId: "s2", type: "assistant", model: "claude-sonnet-4-6" });
  });

  test("returns all events without filters", () => {
    const { events, total } = listEvents(db, {});
    expect(total).toBe(4);
    expect(events.length).toBe(4);
  });

  test("filters by sessionId", () => {
    const { events, total } = listEvents(db, { sessionId: "s1" });
    expect(total).toBe(3);
    expect(events.length).toBe(3);
  });

  test("filters by type", () => {
    const { events, total } = listEvents(db, { type: "user" });
    expect(total).toBe(1);
    expect((events[0] as any).type).toBe("user");
  });

  test("filters by model prefix", () => {
    const { events, total } = listEvents(db, { model: "claude-haiku" });
    expect(total).toBe(1);
  });

  test("filters by agentIds — main agent only (sentinel __main__)", () => {
    const { events, total } = listEvents(db, { sessionId: "s1", agentIds: ["__main__"] });
    expect(total).toBe(2); // e1 and e2 have no agentId
    events.forEach(e => expect((e as any).agent_id).toBeNull());
  });

  test("filters by agentIds — specific agent", () => {
    const { events, total } = listEvents(db, { sessionId: "s1", agentIds: ["agent-A"] });
    expect(total).toBe(1);
    expect((events[0] as any).agent_id).toBe("agent-A");
  });

  test("filters by agentIds — main + specific agent", () => {
    const { events, total } = listEvents(db, { sessionId: "s1", agentIds: ["__main__", "agent-A"] });
    expect(total).toBe(3);
  });

  test("search via FTS5", () => {
    const searchLine = JSON.stringify({
      uuid: "search-e1",
      type: "assistant",
      timestamp: "2026-01-01T00:00:00.000Z",
      sessionId: "s1",
      cwd: "/test/project",
      specialKeyword: "xyzzy12345",
      message: { model: "claude-sonnet-4-6", role: "assistant", content: [{ type: "text", text: "hi" }],
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    });
    processJsonlLine(db, searchLine, "-test-project");

    const { events, total } = listEvents(db, { search: "xyzzy12345" });
    expect(total).toBe(1);
    expect((events[0] as any).id).toContain("search-e1");
  });

  test("enforces max limit of 1000", () => {
    const { events } = listEvents(db, { limit: 99999 });
    expect(events.length).toBe(4);
  });

  test("pagination with offset", () => {
    const { events } = listEvents(db, { limit: 2, offset: 0 });
    expect(events.length).toBe(2);
    const { events: page2 } = listEvents(db, { limit: 2, offset: 2 });
    expect(page2.length).toBe(2);
    const ids1 = (events as any[]).map(e => e.id);
    const ids2 = (page2 as any[]).map(e => e.id);
    expect(ids1).not.toEqual(ids2);
  });
});

describe("listAgentSummaries", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    seedEvent(db, { uuid: "e1", sessionId: "s1", type: "assistant", model: "claude-sonnet-4-6" });
    seedEvent(db, { uuid: "e2", sessionId: "s1", type: "user" });
    seedEvent(db, { uuid: "e3", sessionId: "s1", type: "assistant", model: "claude-haiku-4-5", agentId: "agent-A" });
  });

  test("returns main agent row with correct aggregates", () => {
    const summaries = listAgentSummaries(db, "s1");
    const main = summaries.find(s => (s as any).id === null);
    expect(main).toBeDefined();
    expect((main as any).event_count).toBe(2);
    expect((main as any).agent_type).toBe("main");
  });

  test("returns subagent row", () => {
    const summaries = listAgentSummaries(db, "s1");
    const sub = summaries.find(s => (s as any).id === "agent-A");
    expect(sub).toBeDefined();
    expect((sub as any).event_count).toBe(1);
    expect((sub as any).last_model).toBe("claude-haiku-4-5");
  });

  test("main agent row comes first", () => {
    const summaries = listAgentSummaries(db, "s1");
    expect((summaries[0] as any).id).toBeNull();
  });

  test("returns empty array for session with no agents", () => {
    const summaries = listAgentSummaries(db, "nonexistent-session");
    expect(summaries).toEqual([]);
  });
});
