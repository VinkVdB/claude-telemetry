// test/server/settings-api.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { applySchema } from "../../src/server/db/schema";
import { createSettingsRoutes } from "../../src/server/api/settings";

describe("Settings API", () => {
  let db: Database;
  let app: Hono;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    app = new Hono();
    createSettingsRoutes(app, db);
  });

  test("GET /api/settings returns defaults when no overrides", async () => {
    const res = await app.request("/api/settings");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body["graph.linkDistance"]).toBe(150);
    expect(body["server.pollInterval"]).toBe(1000);
    expect(body["pricing.models"]).toBeDefined();
  });

  test("PUT /api/settings stores and returns merged values", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "graph.linkDistance": 200 }),
    });
    expect(res.status).toBe(200);

    const get = await app.request("/api/settings");
    const body = await get.json();
    expect(body["graph.linkDistance"]).toBe(200);
    // Other defaults still present
    expect(body["server.pollInterval"]).toBe(1000);
  });

  test("PUT /api/settings rejects invalid values", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "graph.linkDistance": 9999 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.key).toBe("graph.linkDistance");
  });

  test("PUT /api/settings rejects unknown keys", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "unknown.key": 42 }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/settings/reset deletes specific keys", async () => {
    // Set a value
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "graph.linkDistance": 200, "server.pollInterval": 2000 }),
    });

    // Reset only linkDistance
    const res = await app.request("/api/settings/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: ["graph.linkDistance"] }),
    });
    expect(res.status).toBe(200);

    // Reset now returns merged settings directly
    const body = await res.json();
    expect(body["graph.linkDistance"]).toBe(150); // back to default
    expect(body["server.pollInterval"]).toBe(2000); // still overridden
  });

  test("POST /api/settings/reset with no keys resets all", async () => {
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "graph.linkDistance": 200 }),
    });

    await app.request("/api/settings/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const get = await app.request("/api/settings");
    const body = await get.json();
    expect(body["graph.linkDistance"]).toBe(150);
  });
});
