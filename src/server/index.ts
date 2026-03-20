// src/server/index.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { join } from "path";
import { stat } from "node:fs/promises";
import { loadConfig } from "./config";
import { getDb } from "./db/connection";
import { startWatcher } from "./ingestion/watcher";
import { getSetting } from "./db/settings";
import { loadPricingFromSettings } from "./db/pricing-loader";
import { createApiRoutes } from "./api/projects";
import { createSessionRoutes } from "./api/sessions";
import { createEventRoutes } from "./api/events";
import { createAgentRoutes } from "./api/agents";
import { createSseRoute } from "./api/sse";
import { createOtelRoutes } from "./otel/receiver";
import { createSettingsRoutes } from "./api/settings";

const config = loadConfig();
const db = getDb(`${config.dataDir}/db/telemetry.db`);

// Load custom pricing from settings DB
loadPricingFromSettings(db);

// Load server settings from DB (env vars take precedence)
const dbPollInterval = getSetting(db, "server.pollInterval");
const dbStabilityThreshold = getSetting(db, "server.stabilityThreshold");
const dbWritePollInterval = getSetting(db, "server.writePollInterval");

const effectivePollInterval = process.env.CT_POLL_INTERVAL != null ? config.pollInterval : (dbPollInterval ?? config.pollInterval);
const effectiveStabilityThreshold = dbStabilityThreshold ?? 200;
const effectiveWritePollInterval = dbWritePollInterval ?? 100;

const app = new Hono();

// Middleware
app.use("/api/*", cors());

// API routes
createApiRoutes(app, db);
createSessionRoutes(app, db);
createEventRoutes(app, db);
createAgentRoutes(app, db);
createSseRoute(app);
createSettingsRoutes(app, db);
if (config.otelEnabled) createOtelRoutes(app, db);

// Serve SPA — Bun.file with explicit CWD-relative path.
// No NODE_ENV guard: bun build eliminates dead branches at build time when NODE_ENV is unset.
// The handler is always registered; in dev it gracefully falls back to index.html if built.
const clientRoot = join(process.cwd(), "dist/client");
const indexHtml = Bun.file(join(clientRoot, "index.html"));

app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/api/")) return next();
  const filePath = join(clientRoot, c.req.path);
  const file = Bun.file(filePath);
  if (await file.exists()) {
    const info = await stat(filePath).catch(() => null);
    if (info && !info.isDirectory()) return new Response(file);
  }
  return new Response(indexHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
});

// Start file watcher
startWatcher(db, {
  projectsDir: config.projectsDir,
  watchMode: config.watchMode,
  pollInterval: effectivePollInterval,
  stabilityThreshold: effectiveStabilityThreshold,
  writePollInterval: effectiveWritePollInterval,
}).then(() => {
  console.log(`[watcher] Watching ${config.projectsDir}`);
});

console.log(`[server] Starting on port ${config.port}`);
export default {
  port: config.port,
  fetch: app.fetch,
};
