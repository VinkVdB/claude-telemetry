import type { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { listEvents } from "../db/queries";

export function createEventRoutes(app: Hono, db: Database): void {
  app.get("/api/events", (c) => {
    const filters = {
      sessionId: c.req.query("sessionId"),
      type: c.req.query("type"),
      model: c.req.query("model"),
      toolName: c.req.query("toolName"),
      limit: c.req.query("limit") ? parseInt(c.req.query("limit")!) : undefined,
      offset: c.req.query("offset") ? parseInt(c.req.query("offset")!) : undefined,
    };
    return c.json(listEvents(db, filters));
  });
}
