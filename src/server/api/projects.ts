import type { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { listProjects, getProject } from "../db/queries";

export function createApiRoutes(app: Hono, db: Database): void {
  app.get("/api/projects", (c) => {
    return c.json(listProjects(db));
  });

  app.get("/api/projects/:id", (c) => {
    const project = getProject(db, c.req.param("id"));
    if (!project) return c.json({ error: "Not found" }, 404);
    return c.json(project);
  });
}
