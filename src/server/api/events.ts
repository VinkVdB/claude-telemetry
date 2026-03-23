import type { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { listEvents } from "../db/queries";

export function createEventRoutes(app: Hono, db: Database): void {
  app.post("/api/events/query", async (c) => {
    let filters: Record<string, any>;
    try {
      filters = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    try {
      const result = listEvents(db, {
        sessionId:  typeof filters.sessionId  === "string" ? filters.sessionId  : undefined,
        type:       typeof filters.type       === "string" ? filters.type       : undefined,
        model:      typeof filters.model      === "string" ? filters.model      : undefined,
        toolName:   typeof filters.toolName   === "string" ? filters.toolName   : undefined,
        agentIds:   Array.isArray(filters.agentIds) ? filters.agentIds.filter((x: any) => typeof x === "string") : undefined,
        search:     typeof filters.search     === "string" ? filters.search     : undefined,
        limit:      typeof filters.limit      === "number" ? filters.limit      : undefined,
        offset:     typeof filters.offset     === "number" ? filters.offset     : undefined,
      });
      return c.json(result);
    } catch (err: any) {
      // FTS5 throws on invalid MATCH syntax
      return c.json({ error: "Invalid search query" }, 400);
    }
  });

  // Keep GET /api/events stub until useInfiniteEvents is updated in Task 7
  app.get("/api/events", (c) => {
    const filters = {
      sessionId: c.req.query("sessionId"),
      type:      c.req.query("type"),
      model:     c.req.query("model"),
      toolName:  c.req.query("toolName"),
      limit:     c.req.query("limit")  ? parseInt(c.req.query("limit")!)  : undefined,
      offset:    c.req.query("offset") ? parseInt(c.req.query("offset")!) : undefined,
    };
    return c.json(listEvents(db, filters));
  });
}
