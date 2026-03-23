import type { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { listEvents, getEventOffsetBySeq } from "../db/queries";

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

  app.post("/api/events/offset", async (c) => {
    let body: Record<string, any>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const seq = typeof body.seq === "number" ? body.seq : undefined;
    if (seq === undefined) return c.json({ error: "seq is required" }, 400);

    const offset = getEventOffsetBySeq(db, seq, {
      sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
      type:      typeof body.type      === "string" ? body.type      : undefined,
      model:     typeof body.model     === "string" ? body.model     : undefined,
      toolName:  typeof body.toolName  === "string" ? body.toolName  : undefined,
      agentIds:  Array.isArray(body.agentIds) ? body.agentIds.filter((x: any) => typeof x === "string") : undefined,
      search:    typeof body.search    === "string" ? body.search    : undefined,
    });
    return c.json({ offset });
  });

}
