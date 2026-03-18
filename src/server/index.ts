// src/server/index.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { join } from "path";
import { loadConfig } from "./config";
import { getDb } from "./db/connection";
import { startWatcher } from "./ingestion/watcher";
import { createApiRoutes } from "./api/projects";
import { createSessionRoutes } from "./api/sessions";
import { createEventRoutes } from "./api/events";
import { createAgentRoutes } from "./api/agents";
import { createSseRoute } from "./api/sse";

const config = loadConfig();
const db = getDb(`${config.dataDir}/db/telemetry.db`);

const app = new Hono();

// Middleware
app.use("/api/*", cors());

// API routes
createApiRoutes(app, db);
createSessionRoutes(app, db);
createEventRoutes(app, db);
createAgentRoutes(app, db);
createSseRoute(app);

// Serve SPA in production
if (process.env.NODE_ENV === "production") {
  const clientRoot = join(process.cwd(), "dist/client");
  app.use("/*", serveStatic({ root: clientRoot }));
  // SPA fallback — all unmatched routes serve index.html for client-side routing
  app.get("*", async (c) => {
    const html = await Bun.file(join(clientRoot, "index.html")).text();
    return c.html(html);
  });
}

// Start file watcher
startWatcher(db, {
  projectsDir: config.projectsDir,
  watchMode: config.watchMode,
  pollInterval: config.pollInterval,
}).then(() => {
  console.log(`[watcher] Watching ${config.projectsDir}`);
});

console.log(`[server] Starting on port ${config.port}`);
export default {
  port: config.port,
  fetch: app.fetch,
};
