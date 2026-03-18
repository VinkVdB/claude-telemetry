import type { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { listAgents } from "../db/queries";

export function createAgentRoutes(app: Hono, db: Database): void {
  app.get("/api/agents/:sessionId", (c) => {
    return c.json(listAgents(db, c.req.param("sessionId")));
  });
}
