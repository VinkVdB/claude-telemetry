// src/server/api/settings.ts
import type { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { getAllSettings, upsertSettings, deleteSettings, deleteAllSettings } from "../db/settings";
import { getDefaults, validateSetting } from "../../shared/settings-defaults";
import { invalidatePricingCache } from "../../shared/pricing";

export function createSettingsRoutes(app: Hono, db: Database): void {
  // GET — return all defaults merged with user overrides
  app.get("/api/settings", (c) => {
    const defaults = getDefaults();
    const overrides = getAllSettings(db);
    return c.json({ ...defaults, ...overrides });
  });

  // PUT — bulk upsert with validation
  app.put("/api/settings", async (c) => {
    const body = await c.req.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return c.json({ error: "Body must be a JSON object" }, 400);
    }

    // Validate all values before writing any
    for (const [key, value] of Object.entries(body)) {
      const result = validateSetting(key, value);
      if (!result.valid) {
        return c.json({ error: result.error, key, constraint: result.error }, 400);
      }
    }

    upsertSettings(db, body);

    // Invalidate pricing cache if pricing was updated
    if ("pricing.models" in body) {
      invalidatePricingCache();
    }

    const defaults = getDefaults();
    const overrides = getAllSettings(db);
    return c.json({ ...defaults, ...overrides });
  });

  // POST /reset — delete specified keys or all
  app.post("/api/settings/reset", async (c) => {
    const body = await c.req.json();
    const keys = body?.keys as string[] | undefined;

    if (keys && keys.length > 0) {
      deleteSettings(db, keys);
    } else {
      deleteAllSettings(db);
    }

    // Always invalidate pricing cache on reset
    invalidatePricingCache();

    // Return merged settings so client can update without a follow-up GET
    const defaults = getDefaults();
    const overrides = getAllSettings(db);
    return c.json({ ...defaults, ...overrides });
  });
}
