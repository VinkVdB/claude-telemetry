// src/server/index.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
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
  app.use("/*", serveStatic({ root: "./dist/client" }));
  app.get("*", serveStatic({ path: "./dist/client/index.html" }));
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
