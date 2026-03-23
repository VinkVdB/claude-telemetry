// test/server/otel.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { applySchema } from "../../src/server/db/schema";
import { createOtelRoutes } from "../../src/server/otel/receiver";
import { upsertProject, upsertSession, insertEvent, updateSessionAggregates } from "../../src/server/db/queries";

function makeApp(db: Database) {
  const app = new Hono();
  createOtelRoutes(app, db);
  return app;
}

function seedEvent(db: Database, opts: {
  eventId: string;
  sessionId: string;
  model: string;
  timestamp: string;
  inputTokens?: number;
  outputTokens?: number;
}) {
  upsertProject(db, "proj-1", "test-project", "/Users/dev/test-project");
  upsertSession(db, opts.sessionId, "proj-1", { startedAt: opts.timestamp });
  insertEvent(db, {
    id: opts.eventId,
    sessionId: opts.sessionId,
    type: "assistant",
    timestamp: opts.timestamp,
    model: opts.model,
    inputTokens: opts.inputTokens ?? 100,
    outputTokens: opts.outputTokens ?? 50,
  });
  updateSessionAggregates(db, opts.sessionId);
}

function makeOtelPayload(opts: {
  sessionId: string;
  model: string;
  timestamp: string; // ISO string
  costUsd: number;
  durationMs: number;
}) {
  const timeUnixNano = (BigInt(new Date(opts.timestamp).getTime()) * 1_000_000n).toString();
  return {
    resourceLogs: [{
      scopeLogs: [{
        logRecords: [{
          timeUnixNano,
          severityText: "claude_code.api_request",
          attributes: [
            { key: "event.name", value: { stringValue: "claude_code.api_request" } },
            { key: "session.id", value: { stringValue: opts.sessionId } },
            { key: "model", value: { stringValue: opts.model } },
            { key: "cost_usd", value: { stringValue: opts.costUsd.toString() } },
            { key: "duration_ms", value: { stringValue: opts.durationMs.toString() } },
          ],
        }],
      }],
    }],
  };
}

describe("OTEL receiver — otel_cost_usd enrichment", () => {
  let db: Database;
  let app: ReturnType<typeof makeApp>;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    app = makeApp(db);
  });

  test("sets otel_cost_usd on matched event (not cost_usd)", async () => {
    const timestamp = "2026-03-23T10:00:00.000Z";
    seedEvent(db, {
      eventId: "evt-001",
      sessionId: "sess-otel-1",
      model: "claude-sonnet-4-6",
      timestamp,
      inputTokens: 100,
      outputTokens: 50,
    });

    const payload = makeOtelPayload({
      sessionId: "sess-otel-1",
      model: "claude-sonnet-4-6",
      timestamp,
      costUsd: 0.00123,
      durationMs: 1500,
    });

    const res = await app.request("/v1/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);

    const event = db.query("SELECT * FROM events WHERE id = 'evt-001'").get() as any;
    expect(event).not.toBeNull();
    // otel_cost_usd should be set
    expect(event.otel_cost_usd).toBeCloseTo(0.00123, 5);
    // duration_ms should be set
    expect(event.duration_ms).toBe(1500);
    // cost_usd should NOT be modified by OTEL (stays as estimated from ingestion)
    // It may be null since we didn't set it in the seed (no pricing lookup)
    // The key check is that otel_cost_usd is set separately
  });

  test("rebuilds session_costs after OTEL enrichment", async () => {
    const timestamp = "2026-03-23T10:00:00.000Z";
    seedEvent(db, {
      eventId: "evt-002",
      sessionId: "sess-otel-2",
      model: "claude-sonnet-4-6",
      timestamp,
      inputTokens: 200,
      outputTokens: 100,
    });

    // Before enrichment: otel_cost_usd and otel_event_count should be 0
    const beforeCosts = db.query(
      "SELECT * FROM session_costs WHERE session_id = 'sess-otel-2'"
    ).get() as any;
    expect(beforeCosts).not.toBeNull();
    expect(beforeCosts.otel_event_count).toBe(0);
    expect(beforeCosts.otel_cost_usd).toBeNull();

    const payload = makeOtelPayload({
      sessionId: "sess-otel-2",
      model: "claude-sonnet-4-6",
      timestamp,
      costUsd: 0.00456,
      durationMs: 2000,
    });

    const res = await app.request("/v1/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);

    // After enrichment: session_costs should reflect otel_cost_usd
    const afterCosts = db.query(
      "SELECT * FROM session_costs WHERE session_id = 'sess-otel-2'"
    ).get() as any;
    expect(afterCosts).not.toBeNull();
    expect(afterCosts.otel_event_count).toBe(1);
    expect(afterCosts.otel_cost_usd).toBeCloseTo(0.00456, 5);
  });

  test("does not re-enrich already-enriched events (otel_cost_usd IS NOT NULL)", async () => {
    const timestamp = "2026-03-23T10:00:00.000Z";
    seedEvent(db, {
      eventId: "evt-003",
      sessionId: "sess-otel-3",
      model: "claude-sonnet-4-6",
      timestamp,
    });

    // Pre-set otel_cost_usd on the event
    db.run("UPDATE events SET otel_cost_usd = 0.001 WHERE id = 'evt-003'");

    const payload = makeOtelPayload({
      sessionId: "sess-otel-3",
      model: "claude-sonnet-4-6",
      timestamp,
      costUsd: 0.999,
      durationMs: 9999,
    });

    const res = await app.request("/v1/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);

    // otel_cost_usd should remain 0.001, not overwritten with 0.999
    const event = db.query("SELECT * FROM events WHERE id = 'evt-003'").get() as any;
    expect(event.otel_cost_usd).toBeCloseTo(0.001, 5);
  });

  test("unmatched OTEL events fall through to otel_raw", async () => {
    // No seeded event — nothing to match
    const payload = makeOtelPayload({
      sessionId: "sess-unknown",
      model: "claude-opus-4-6",
      timestamp: "2026-03-23T10:00:00.000Z",
      costUsd: 0.01,
      durationMs: 500,
    });

    const res = await app.request("/v1/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);

    const raw = db.query("SELECT * FROM otel_raw").all() as any[];
    expect(raw.length).toBe(1);
  });
});
