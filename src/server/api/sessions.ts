import type { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { listSessions, getSession, getSessionCostBreakdown } from "../db/queries";

export function createSessionRoutes(app: Hono, db: Database): void {
  app.get("/api/sessions", (c) => {
    const projectId = c.req.query("projectId");
    if (!projectId) return c.json({ error: "projectId required" }, 400);
    return c.json(listSessions(db, projectId));
  });

  app.get("/api/sessions/:id", (c) => {
    const session = getSession(db, c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(session);
  });

  app.get("/api/sessions/:id/costs", (c) => {
    const id = c.req.param("id");
    return c.json(getSessionCostBreakdown(db, id));
  });
}
