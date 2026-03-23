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
