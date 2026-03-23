// src/server/otel/receiver.ts
import type { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { updateSessionAggregates } from "../db/queries";

export function createOtelRoutes(app: Hono, db: Database): void {
  // Accept OTLP HTTP/JSON log exports
  app.post("/v1/logs", async (c) => {
    try {
      const body = await c.req.json();
      const resourceLogs = body.resourceLogs ?? [];

      for (const rl of resourceLogs) {
        for (const scopeLog of rl.scopeLogs ?? []) {
          for (const logRecord of scopeLog.logRecords ?? []) {
            processLogRecord(db, logRecord);
          }
        }
      }

      return c.json({ partialSuccess: {} });
    } catch (err) {
      console.error("[otel] Error processing logs:", err);
      return c.json({ error: "Failed to process" }, 400);
    }
  });

  // Accept OTLP HTTP/JSON metric exports (store raw for browsing)
  app.post("/v1/metrics", async (c) => {
    try {
      const body = await c.req.json();
      // Store raw metrics in otel_raw for the raw explorer
      const id = crypto.randomUUID();
      db.run(
        "INSERT INTO otel_raw (id, event_type, timestamp, data) VALUES (?, ?, datetime('now'), ?)",
        [id, "metrics", JSON.stringify(body)]
      );
      return c.json({ partialSuccess: {} });
    } catch {
      return c.json({ error: "Failed to process" }, 400);
    }
  });
}

function processLogRecord(db: Database, record: any): void {
  const attrs = parseAttributes(record.attributes ?? []);
  const eventName = attrs["event.name"] ?? record.severityText;

  if (eventName === "claude_code.api_request") {
    // Try to enrich existing event with cost_usd and duration_ms
    const sessionId = attrs["session.id"];
    const costUsd = parseFloat(attrs["cost_usd"] ?? "0");
    const durationMs = parseInt(attrs["duration_ms"] ?? "0", 10);
    const model = attrs["model"];
    const timestamp = record.timeUnixNano
      ? new Date(parseInt(record.timeUnixNano) / 1_000_000).toISOString()
      : null;

    if (sessionId && timestamp) {
      // Find closest matching event by session + timestamp (within 5s window)
      const existing = db.query(`
        SELECT id FROM events
        WHERE session_id = ? AND model = ? AND otel_cost_usd IS NULL
          AND abs(julianday(timestamp) - julianday(?)) * 86400 < 5
        ORDER BY abs(julianday(timestamp) - julianday(?))
        LIMIT 1
      `).get(sessionId, model, timestamp, timestamp) as any;

      if (existing) {
        db.run(
          "UPDATE events SET otel_cost_usd = ?, duration_ms = ? WHERE id = ?",
          [costUsd, durationMs, existing.id]
        );
        updateSessionAggregates(db, sessionId);
        return;
      }
    }
  }

  // Store unmatched OTEL data for raw browsing
  const id = crypto.randomUUID();
  db.run(
    "INSERT INTO otel_raw (id, session_id, event_type, timestamp, data) VALUES (?, ?, ?, datetime('now'), ?)",
    [id, attrs["session.id"] ?? null, eventName, JSON.stringify(record)]
  );
}

function parseAttributes(attrs: any[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const attr of attrs) {
    if (attr.key && attr.value) {
      result[attr.key] = attr.value.stringValue ?? attr.value.intValue?.toString() ?? attr.value.doubleValue?.toString() ?? "";
    }
  }
  return result;
}
