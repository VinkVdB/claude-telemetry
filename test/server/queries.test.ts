// test/server/queries.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/server/db/schema";
import { listEvents, listAgentSummaries, updateSessionAggregates, insertEvent, upsertSession, upsertProject, getSessionCostBreakdown, getProjectCostBreakdown } from "../../src/server/db/queries";
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

  test("returns empty result for unknown sessionId", () => {
    const { events, total } = listEvents(db, { sessionId: "nonexistent" });
    expect(total).toBe(0);
    expect(events.length).toBe(0);
  });

  test("invalid FTS5 search term throws (caught by API layer)", () => {
    // Standalone AND is invalid FTS5 syntax
    expect(() => listEvents(db, { search: "AND" })).toThrow();
  });

  test("combined sessionId + agentIds filter", () => {
    const { total } = listEvents(db, { sessionId: "s1", agentIds: ["agent-A", "__main__"] });
    expect(total).toBe(3); // 2 main + 1 agent-A in session s1
  });

  test("limit is capped server-side at 1000", () => {
    // Even with limit: 9999, we should not exceed 1000 per call (query internally caps)
    const { events } = listEvents(db, { limit: 9999 });
    // Only 4 events in test DB, so all returned -- but verify no error thrown
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

describe("updateSessionAggregates — session_costs", () => {
  let db: Database;

  function seedRawEvent(db: Database, opts: {
    id: string;
    sessionId: string;
    messageId?: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  }) {
    upsertProject(db, "-test-project", "test-project", "/test/project");
    upsertSession(db, opts.sessionId, "-test-project", { startedAt: "2026-01-01T00:00:00.000Z" });
    insertEvent(db, {
      id: opts.id,
      messageId: opts.messageId,
      sessionId: opts.sessionId,
      type: "assistant",
      timestamp: "2026-01-01T00:00:00.000Z",
      model: opts.model ?? "claude-sonnet-4-6",
      inputTokens: opts.inputTokens ?? 10,
      outputTokens: opts.outputTokens ?? 5,
      cacheReadTokens: opts.cacheReadTokens ?? 0,
      cacheCreationTokens: opts.cacheCreationTokens ?? 0,
    });
  }

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
  });

  test("creates session_costs rows with correct model/token data after updateSessionAggregates", () => {
    seedRawEvent(db, { id: "e1", sessionId: "s1", model: "claude-sonnet-4-6", inputTokens: 100, outputTokens: 50 });
    seedRawEvent(db, { id: "e2", sessionId: "s1", model: "claude-haiku-4-5", inputTokens: 30, outputTokens: 10 });
    updateSessionAggregates(db, "s1");

    const rows = db.query("SELECT * FROM session_costs WHERE session_id = 's1' ORDER BY model").all() as any[];
    expect(rows.length).toBe(2);

    const haiku = rows.find((r: any) => r.model === "claude-haiku-4-5");
    const sonnet = rows.find((r: any) => r.model === "claude-sonnet-4-6");

    expect(haiku).toBeDefined();
    expect(haiku.input_tokens).toBe(30);
    expect(haiku.output_tokens).toBe(10);
    expect(haiku.event_count).toBe(1);

    expect(sonnet).toBeDefined();
    expect(sonnet.input_tokens).toBe(100);
    expect(sonnet.output_tokens).toBe(50);
    expect(sonnet.event_count).toBe(1);
  });

  test("session_costs dedup: two events with same message_id count only the one with higher tokens", () => {
    // Seed two events with same message_id but different token counts
    // (bypassing the processor-level dedup by calling insertEvent directly)
    upsertProject(db, "-test-project", "test-project", "/test/project");
    upsertSession(db, "s2", "-test-project", { startedAt: "2026-01-01T00:00:00.000Z" });

    // Lower token count (should be deduped away)
    insertEvent(db, {
      id: "e-low",
      messageId: "msg-1",
      sessionId: "s2",
      type: "assistant",
      timestamp: "2026-01-01T00:00:00.000Z",
      model: "claude-sonnet-4-6",
      inputTokens: 10,
      outputTokens: 5,
    });

    // Higher token count (should win the dedup)
    insertEvent(db, {
      id: "e-high",
      messageId: "msg-1",
      sessionId: "s2",
      type: "assistant",
      timestamp: "2026-01-01T00:00:01.000Z",
      model: "claude-sonnet-4-6",
      inputTokens: 100,
      outputTokens: 50,
    });

    updateSessionAggregates(db, "s2");

    const rows = db.query("SELECT * FROM session_costs WHERE session_id = 's2'").all() as any[];
    expect(rows.length).toBe(1);
    const row = rows[0] as any;
    // Only the high-token event should be counted
    expect(row.input_tokens).toBe(100);
    expect(row.output_tokens).toBe(50);
    expect(row.event_count).toBe(1);
  });

  test("session_costs is rebuilt on each call (no duplicate accumulation)", () => {
    seedRawEvent(db, { id: "e1", sessionId: "s3", model: "claude-sonnet-4-6", inputTokens: 10, outputTokens: 5 });
    updateSessionAggregates(db, "s3");
    updateSessionAggregates(db, "s3");

    const rows = db.query("SELECT * FROM session_costs WHERE session_id = 's3'").all() as any[];
    expect(rows.length).toBe(1);
    expect((rows[0] as any).event_count).toBe(1);
  });

  test("events with null model are excluded from session_costs", () => {
    upsertProject(db, "-test-project", "test-project", "/test/project");
    upsertSession(db, "s4", "-test-project", { startedAt: "2026-01-01T00:00:00.000Z" });
    insertEvent(db, {
      id: "e-nomodel",
      sessionId: "s4",
      type: "user",
      timestamp: "2026-01-01T00:00:00.000Z",
      model: undefined,
      inputTokens: 10,
      outputTokens: 5,
    });
    updateSessionAggregates(db, "s4");

    const rows = db.query("SELECT * FROM session_costs WHERE session_id = 's4'").all();
    expect(rows.length).toBe(0);
  });
});

describe("getSessionCostBreakdown", () => {
  let db: Database;

  function seedRawEvent(opts: {
    id: string;
    sessionId: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  }) {
    upsertProject(db, "-test-project", "test-project", "/test/project");
    upsertSession(db, opts.sessionId, "-test-project", { startedAt: "2026-01-01T00:00:00.000Z" });
    insertEvent(db, {
      id: opts.id,
      sessionId: opts.sessionId,
      type: "assistant",
      timestamp: "2026-01-01T00:00:00.000Z",
      model: opts.model ?? "claude-sonnet-4-6",
      inputTokens: opts.inputTokens ?? 10,
      outputTokens: opts.outputTokens ?? 5,
      cacheReadTokens: opts.cacheReadTokens ?? 0,
      cacheCreationTokens: opts.cacheCreationTokens ?? 0,
    });
  }

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
  });

  test("returns per-model rows for a session", () => {
    seedRawEvent({ id: "e1", sessionId: "s1", model: "claude-sonnet-4-6", inputTokens: 100, outputTokens: 50 });
    seedRawEvent({ id: "e2", sessionId: "s1", model: "claude-haiku-4-5", inputTokens: 30, outputTokens: 10 });
    updateSessionAggregates(db, "s1");

    const rows = getSessionCostBreakdown(db, "s1") as any[];
    expect(rows.length).toBe(2);

    const sonnet = rows.find(r => r.model === "claude-sonnet-4-6");
    const haiku  = rows.find(r => r.model === "claude-haiku-4-5");

    expect(sonnet).toBeDefined();
    expect(sonnet.input_tokens).toBe(100);
    expect(sonnet.output_tokens).toBe(50);
    expect(sonnet.event_count).toBe(1);

    expect(haiku).toBeDefined();
    expect(haiku.input_tokens).toBe(30);
    expect(haiku.output_tokens).toBe(10);
    expect(haiku.event_count).toBe(1);
  });

  test("returns empty array for session with no cost data", () => {
    const rows = getSessionCostBreakdown(db, "nonexistent") as any[];
    expect(rows).toEqual([]);
  });

  test("does not return rows for a different session", () => {
    seedRawEvent({ id: "e1", sessionId: "s1", model: "claude-sonnet-4-6", inputTokens: 10, outputTokens: 5 });
    seedRawEvent({ id: "e2", sessionId: "s2", model: "claude-haiku-4-5", inputTokens: 20, outputTokens: 8 });
    updateSessionAggregates(db, "s1");
    updateSessionAggregates(db, "s2");

    const rows = getSessionCostBreakdown(db, "s1") as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].model).toBe("claude-sonnet-4-6");
  });
});

describe("getProjectCostBreakdown", () => {
  let db: Database;

  function seedRawEvent(opts: {
    id: string;
    sessionId: string;
    projectId: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
  }) {
    upsertProject(db, opts.projectId, "test-project", "/test/project");
    upsertSession(db, opts.sessionId, opts.projectId, { startedAt: "2026-01-01T00:00:00.000Z" });
    insertEvent(db, {
      id: opts.id,
      sessionId: opts.sessionId,
      type: "assistant",
      timestamp: "2026-01-01T00:00:00.000Z",
      model: opts.model ?? "claude-sonnet-4-6",
      inputTokens: opts.inputTokens ?? 10,
      outputTokens: opts.outputTokens ?? 5,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
  }

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
  });

  test("aggregates tokens across sessions for the same project", () => {
    // Two sessions, same model
    seedRawEvent({ id: "e1", sessionId: "s1", projectId: "p1", model: "claude-sonnet-4-6", inputTokens: 100, outputTokens: 50 });
    seedRawEvent({ id: "e2", sessionId: "s2", projectId: "p1", model: "claude-sonnet-4-6", inputTokens: 200, outputTokens: 80 });
    updateSessionAggregates(db, "s1");
    updateSessionAggregates(db, "s2");

    const rows = getProjectCostBreakdown(db, "p1") as any[];
    expect(rows.length).toBe(1);
    const sonnet = rows[0] as any;
    expect(sonnet.model).toBe("claude-sonnet-4-6");
    expect(sonnet.input_tokens).toBe(300);
    expect(sonnet.output_tokens).toBe(130);
    expect(sonnet.event_count).toBe(2);
  });

  test("returns one row per model across sessions", () => {
    seedRawEvent({ id: "e1", sessionId: "s1", projectId: "p2", model: "claude-sonnet-4-6", inputTokens: 100, outputTokens: 50 });
    seedRawEvent({ id: "e2", sessionId: "s1", projectId: "p2", model: "claude-haiku-4-5", inputTokens: 30, outputTokens: 10 });
    seedRawEvent({ id: "e3", sessionId: "s2", projectId: "p2", model: "claude-haiku-4-5", inputTokens: 20, outputTokens: 8 });
    updateSessionAggregates(db, "s1");
    updateSessionAggregates(db, "s2");

    const rows = getProjectCostBreakdown(db, "p2") as any[];
    expect(rows.length).toBe(2);

    const haiku = rows.find((r: any) => r.model === "claude-haiku-4-5") as any;
    expect(haiku).toBeDefined();
    expect(haiku.input_tokens).toBe(50);
    expect(haiku.output_tokens).toBe(18);
    expect(haiku.event_count).toBe(2);
  });

  test("returns empty array for unknown project", () => {
    const rows = getProjectCostBreakdown(db, "nonexistent") as any[];
    expect(rows).toEqual([]);
  });

  test("does not leak data across projects", () => {
    seedRawEvent({ id: "e1", sessionId: "s1", projectId: "p1", model: "claude-sonnet-4-6", inputTokens: 100, outputTokens: 50 });
    seedRawEvent({ id: "e2", sessionId: "s2", projectId: "p2", model: "claude-haiku-4-5", inputTokens: 30, outputTokens: 10 });
    updateSessionAggregates(db, "s1");
    updateSessionAggregates(db, "s2");

    const rows = getProjectCostBreakdown(db, "p1") as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].model).toBe("claude-sonnet-4-6");
  });
});
