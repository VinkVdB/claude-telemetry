// test/server/api.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { applySchema } from "../../src/server/db/schema";
import { processJsonlLine } from "../../src/server/ingestion/processor";
import { insertEvent, upsertProject, upsertSession, updateSessionAggregates } from "../../src/server/db/queries";
import { createApiRoutes } from "../../src/server/api/projects";
import { createSessionRoutes } from "../../src/server/api/sessions";
import { createEventRoutes } from "../../src/server/api/events";

describe("API", () => {
  let db: Database;
  let app: Hono;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);

    app = new Hono();
    createApiRoutes(app, db);
    createSessionRoutes(app, db);
    createEventRoutes(app, db);

    // Seed test data
    const line = JSON.stringify({
      uuid: "msg-001",
      type: "assistant",
      timestamp: "2026-03-18T10:00:00.000Z",
      sessionId: "sess-abc",
      cwd: "/Users/dev/my-project",
      gitBranch: "main",
      slug: "test-session",
      message: {
        model: "claude-sonnet-4-6",
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    });
    processJsonlLine(db, line, "-Users-dev-my-project");
  });

  test("GET /api/projects returns project list", async () => {
    const res = await app.request("/api/projects");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].name).toBe("my-project");
    expect(data[0].session_count).toBe(1);
  });

  test("GET /api/projects/:id returns single project", async () => {
    const res = await app.request("/api/projects/-Users-dev-my-project");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("my-project");
  });

  test("GET /api/projects/:id returns 404 for unknown", async () => {
    const res = await app.request("/api/projects/nonexistent");
    expect(res.status).toBe(404);
  });

  test("GET /api/sessions?projectId= returns sessions", async () => {
    const res = await app.request("/api/sessions?projectId=-Users-dev-my-project");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].id).toBe("sess-abc");
  });

  test("GET /api/events is removed (404)", async () => {
    const res = await app.request("/api/events?sessionId=sess-abc");
    expect(res.status).toBe(404);
  });

  test("POST /api/events/query filters by sessionId", async () => {
    const res = await app.request("/api/events/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "sess-abc" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.events.length).toBe(1);
    expect(data.total).toBe(1);
  });

  test("POST /api/events/query returns 400 for invalid JSON", async () => {
    const res = await app.request("/api/events/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });

  test("GET /api/sessions/:id/agent-summaries returns main agent", async () => {
    const res = await app.request("/api/sessions/sess-abc/agent-summaries");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    const main = data.find((s: any) => s.id === null);
    expect(main).toBeDefined();
    expect(main.event_count).toBeGreaterThan(0);
  });
});

describe("agent summaries with subagent", () => {
  let db2: Database;
  let app2: Hono;

  beforeEach(() => {
    db2 = new Database(":memory:");
    applySchema(db2);
    app2 = new Hono();
    createApiRoutes(app2, db2);
    createSessionRoutes(app2, db2);
    createEventRoutes(app2, db2);

    // Main agent event
    processJsonlLine(db2, JSON.stringify({
      uuid: "main-1", type: "assistant", timestamp: "2026-01-01T00:00:00.000Z",
      sessionId: "s-test", cwd: "/p",
      message: { model: "claude-sonnet-4-6", role: "assistant", content: [{ type: "text", text: "hi" }],
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    }), "-p");

    // Subagent event
    processJsonlLine(db2, JSON.stringify({
      uuid: "sub-1", type: "assistant", timestamp: "2026-01-01T01:00:00.000Z",
      sessionId: "s-test", cwd: "/p", isSidechain: true, agentId: "agent-XYZ",
      message: { model: "claude-haiku-4-5", role: "assistant", content: [{ type: "text", text: "sub" }],
        usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    }), "-p");
  });

  test("returns main + subagent summary", async () => {
    const res = await app2.request("/api/sessions/s-test/agent-summaries");
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(data.length).toBe(2);
    const main = data.find(s => s.id === null);
    const sub  = data.find(s => s.id === "agent-XYZ");
    expect(main.event_count).toBe(1);
    expect(sub.event_count).toBe(1);
    expect(sub.last_model).toBe("claude-haiku-4-5");
  });

  test("POST /api/events/query filters by __main__ sentinel", async () => {
    const res = await app2.request("/api/events/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "s-test", agentIds: ["__main__"] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.total).toBe(1);
    expect(data.events[0].agent_id).toBeNull();
  });
});

describe("OTEL-aware cost computation", () => {
  let db: Database;
  let app: Hono;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    app = new Hono();
    createApiRoutes(app, db);
    createSessionRoutes(app, db);
    createEventRoutes(app, db);

    upsertProject(db, "proj-otel", "otel-project", "/otel-project");
    upsertSession(db, "sess-otel", "proj-otel", { startedAt: "2026-03-01T00:00:00.000Z" });
  });

  test("GET /api/sessions/:id/costs uses OTEL cost when all events have otel_cost_usd", async () => {
    // Two events for the same model, both with otel_cost_usd
    insertEvent(db, {
      id: "e-otel-1", sessionId: "sess-otel", type: "assistant", timestamp: "2026-03-01T00:00:00.000Z",
      model: "claude-sonnet-4-6", inputTokens: 1000, outputTokens: 500,
      cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.025,
    });
    insertEvent(db, {
      id: "e-otel-2", sessionId: "sess-otel", type: "assistant", timestamp: "2026-03-01T01:00:00.000Z",
      model: "claude-sonnet-4-6", inputTokens: 2000, outputTokens: 1000,
      cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.05,
    });
    // Set otel_cost_usd on both events
    db.run("UPDATE events SET otel_cost_usd = 0.025 WHERE id = 'e-otel-1'");
    db.run("UPDATE events SET otel_cost_usd = 0.05 WHERE id = 'e-otel-2'");
    updateSessionAggregates(db, "sess-otel");

    const res = await app.request("/api/sessions/sess-otel/costs");
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(data.length).toBe(1);
    const row = data[0];
    // OTEL complete: otel_event_count === event_count
    expect(row.otel_event_count).toBe(2);
    expect(row.event_count).toBe(2);
    // cost_usd should be otel total (0.025 + 0.05 = 0.075)
    expect(row.cost_usd).toBeCloseTo(0.075, 6);
    // Breakdown costs should sum to cost_usd
    expect(row.input_cost + row.output_cost + row.cache_read_cost + row.cache_creation_cost).toBeCloseTo(row.cost_usd, 6);
  });

  test("GET /api/sessions/:id/costs uses token-based cost when OTEL is partial", async () => {
    insertEvent(db, {
      id: "e-partial-1", sessionId: "sess-otel", type: "assistant", timestamp: "2026-03-01T00:00:00.000Z",
      model: "claude-sonnet-4-6", inputTokens: 1000000, outputTokens: 0,
      cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0,
    });
    insertEvent(db, {
      id: "e-partial-2", sessionId: "sess-otel", type: "assistant", timestamp: "2026-03-01T01:00:00.000Z",
      model: "claude-sonnet-4-6", inputTokens: 1000000, outputTokens: 0,
      cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0,
    });
    // Only one event has otel_cost_usd
    db.run("UPDATE events SET otel_cost_usd = 0.1 WHERE id = 'e-partial-1'");
    updateSessionAggregates(db, "sess-otel");

    const res = await app.request("/api/sessions/sess-otel/costs");
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(data.length).toBe(1);
    const row = data[0];
    expect(row.otel_event_count).toBe(1);
    expect(row.event_count).toBe(2);
    // Should fall back to token-based: 2M input tokens * $3/M = $6
    expect(row.cost_usd).toBeCloseTo(6, 4);
    expect(row.input_cost).toBeCloseTo(6, 4);
  });

  test("GET /api/projects/:id/costs uses OTEL cost when all session events have otel_cost_usd", async () => {
    insertEvent(db, {
      id: "e-proj-1", sessionId: "sess-otel", type: "assistant", timestamp: "2026-03-01T00:00:00.000Z",
      model: "claude-sonnet-4-6", inputTokens: 1000, outputTokens: 500,
      cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.01,
    });
    db.run("UPDATE events SET otel_cost_usd = 0.01 WHERE id = 'e-proj-1'");
    updateSessionAggregates(db, "sess-otel");

    const res = await app.request("/api/projects/proj-otel/costs");
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(data.length).toBe(1);
    const row = data[0];
    expect(row.cost_usd).toBeCloseTo(0.01, 6);
  });

  test("GET /api/projects/:id/costs uses token-based cost when OTEL is partial", async () => {
    insertEvent(db, {
      id: "e-proj-partial-1", sessionId: "sess-otel", type: "assistant", timestamp: "2026-03-01T00:00:00.000Z",
      model: "claude-sonnet-4-6", inputTokens: 1000000, outputTokens: 0,
      cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0,
    });
    insertEvent(db, {
      id: "e-proj-partial-2", sessionId: "sess-otel", type: "assistant", timestamp: "2026-03-01T01:00:00.000Z",
      model: "claude-sonnet-4-6", inputTokens: 1000000, outputTokens: 0,
      cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0,
    });
    db.run("UPDATE events SET otel_cost_usd = 0.5 WHERE id = 'e-proj-partial-1'");
    updateSessionAggregates(db, "sess-otel");

    const res = await app.request("/api/projects/proj-otel/costs");
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(data.length).toBe(1);
    const row = data[0];
    // Partial OTEL: fall back to token-based
    expect(row.otel_event_count).toBe(1);
    expect(row.event_count).toBe(2);
    expect(row.cost_usd).toBeCloseTo(6, 4);
  });
});
