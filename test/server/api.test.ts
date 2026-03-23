// test/server/api.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { applySchema } from "../../src/server/db/schema";
import { processJsonlLine } from "../../src/server/ingestion/processor";
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
