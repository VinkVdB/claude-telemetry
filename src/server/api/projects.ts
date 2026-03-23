import type { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { listProjects, getProject, getProjectCostBreakdown, updateProject } from "../db/queries";
import { applyOtelCost } from "./sessions";

export function createApiRoutes(app: Hono, db: Database): void {
  app.get("/api/projects", (c) => {
    return c.json(listProjects(db));
  });

  app.get("/api/projects/:id", (c) => {
    const project = getProject(db, c.req.param("id"));
    if (!project) return c.json({ error: "Not found" }, 404);
    return c.json(project);
  });

  app.get("/api/projects/:id/costs", (c) => {
    const id = c.req.param("id");
    const rows = getProjectCostBreakdown(db, id) as any[];
    return c.json(rows.map(applyOtelCost));
  });

  app.patch("/api/projects/:id", async (c) => {
    const id = c.req.param("id");
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const updates: { name?: string; path?: string } = {};
    if (typeof body.name === "string") updates.name = body.name.trim();
    if (typeof body.path === "string") updates.path = body.path.trim();
    if (Object.keys(updates).length === 0) return c.json({ error: "No valid fields to update" }, 400);
    updateProject(db, id, updates);
    const project = getProject(db, id);
    if (!project) return c.json({ error: "Not found" }, 404);
    return c.json(project);
  });
}
