# Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app settings page with 4 tabs (Pricing, Graph, Server, Display) backed by SQLite, so users can configure model pricing, agent graph visuals, server polling, and display formatting.

**Architecture:** SQLite key-value `settings` table stores only user overrides. A shared defaults registry (`settings-defaults.ts`) defines all keys, defaults, constraints, and tooltips. React context delivers resolved settings (defaults merged with overrides) to all components. Server settings read from DB on startup with env var precedence.

**Tech Stack:** Bun + Hono (backend), React 19 + Tailwind CSS v4 (frontend), SQLite via `bun:sqlite`, `bun:test`

**Spec:** `docs/superpowers/specs/2026-03-20-settings-page-design.md`

---

### Task 1: Settings Defaults Registry

**Files:**
- Create: `src/shared/settings-defaults.ts`
- Test: `test/server/settings-defaults.test.ts`

This is the single source of truth for all setting keys, defaults, types, validation constraints, and tooltips.

- [ ] **Step 1: Write the failing test**

```typescript
// test/server/settings-defaults.test.ts
import { describe, test, expect } from "bun:test";
import {
  SETTINGS_REGISTRY,
  getDefault,
  getDefaults,
  validateSetting,
  type SettingDefinition,
} from "../../src/shared/settings-defaults";

describe("settings-defaults", () => {
  test("registry has all expected top-level groups", () => {
    const keys = Object.keys(SETTINGS_REGISTRY);
    expect(keys).toContain("pricing.models");
    expect(keys).toContain("graph.agentColors");
    expect(keys).toContain("graph.continuousSimulation");
    expect(keys).toContain("graph.linkDistance");
    expect(keys).toContain("server.pollInterval");
    expect(keys).toContain("display.maxLoadedEvents");
  });

  test("getDefault returns default for known key", () => {
    expect(getDefault("graph.linkDistance")).toBe(150);
    expect(getDefault("server.pollInterval")).toBe(1000);
  });

  test("getDefault returns undefined for unknown key", () => {
    expect(getDefault("nonexistent.key")).toBeUndefined();
  });

  test("getDefaults returns all defaults merged", () => {
    const defaults = getDefaults();
    expect(defaults["graph.linkDistance"]).toBe(150);
    expect(defaults["server.pollInterval"]).toBe(1000);
    expect(defaults["display.maxLoadedEvents"]).toBe(500);
  });

  test("validateSetting passes for valid number in range", () => {
    const result = validateSetting("graph.linkDistance", 200);
    expect(result).toEqual({ valid: true });
  });

  test("validateSetting fails for number below min", () => {
    const result = validateSetting("graph.linkDistance", 10);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("50");
  });

  test("validateSetting fails for number above max", () => {
    const result = validateSetting("graph.linkDistance", 999);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("500");
  });

  test("validateSetting passes for valid agentColors array", () => {
    const result = validateSetting("graph.agentColors", ["#ff0000", "#00ff00"]);
    expect(result).toEqual({ valid: true });
  });

  test("validateSetting fails for empty agentColors array", () => {
    const result = validateSetting("graph.agentColors", []);
    expect(result.valid).toBe(false);
  });

  test("validateSetting passes for valid pricing.models object", () => {
    const result = validateSetting("pricing.models", {
      "test-model": {
        inputPerMToken: 1,
        outputPerMToken: 2,
        cacheReadPerMToken: 0.1,
        cacheWritePerMToken: 0.5,
      },
    });
    expect(result).toEqual({ valid: true });
  });

  test("validateSetting fails for pricing with negative rate", () => {
    const result = validateSetting("pricing.models", {
      "test-model": {
        inputPerMToken: -1,
        outputPerMToken: 2,
        cacheReadPerMToken: 0.1,
        cacheWritePerMToken: 0.5,
      },
    });
    expect(result.valid).toBe(false);
  });

  test("every registry entry has required fields", () => {
    for (const [key, def] of Object.entries(SETTINGS_REGISTRY)) {
      expect(def.type, `${key} missing type`).toBeDefined();
      expect(def.defaultValue, `${key} missing defaultValue`).toBeDefined();
      expect(def.tooltip, `${key} missing tooltip`).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/server/settings-defaults.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/shared/settings-defaults.ts

export interface SettingDefinition {
  type: "number" | "boolean" | "string" | "string[]" | "json";
  defaultValue: any;
  tooltip: string;
  min?: number;
  max?: number;
  minItems?: number;
  /** Custom validator for complex types (pricing, colors) */
  validate?: (value: any) => { valid: boolean; error?: string };
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const pricingValidator = (value: any): ValidationResult => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { valid: false, error: "Must be an object of model pricing entries" };
  for (const [model, rates] of Object.entries(value)) {
    if (!model || typeof model !== "string")
      return { valid: false, error: "Model name must be a non-empty string" };
    const r = rates as any;
    for (const field of ["inputPerMToken", "outputPerMToken", "cacheReadPerMToken", "cacheWritePerMToken"]) {
      if (typeof r[field] !== "number" || r[field] < 0)
        return { valid: false, error: `${model}.${field} must be a number >= 0` };
    }
  }
  return { valid: true };
};

const colorArrayValidator = (value: any): ValidationResult => {
  if (!Array.isArray(value) || value.length < 1)
    return { valid: false, error: "Must have at least 1 color" };
  for (const c of value) {
    if (typeof c !== "string" || !/^#[0-9a-fA-F]{6}$/.test(c))
      return { valid: false, error: `Invalid hex color: ${c}` };
  }
  return { valid: true };
};

const hexColorValidator = (value: any): ValidationResult => {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value))
    return { valid: false, error: "Must be a valid hex color (e.g. #003864)" };
  return { valid: true };
};

export const SETTINGS_REGISTRY: Record<string, SettingDefinition> = {
  // --- Pricing ---
  "pricing.models": {
    type: "json",
    defaultValue: {
      "claude-opus-4-6": { inputPerMToken: 15, outputPerMToken: 75, cacheReadPerMToken: 1.5, cacheWritePerMToken: 18.75 },
      "claude-sonnet-4-6": { inputPerMToken: 3, outputPerMToken: 15, cacheReadPerMToken: 0.3, cacheWritePerMToken: 3.75 },
      "claude-haiku-4-5": { inputPerMToken: 0.80, outputPerMToken: 4, cacheReadPerMToken: 0.08, cacheWritePerMToken: 1 },
    },
    tooltip: "USD per 1M tokens. Changes apply to new events only — existing costs are not recalculated.",
    validate: pricingValidator,
  },

  // --- Agent Graph ---
  "graph.agentColors": {
    type: "string[]",
    defaultValue: ["#00a2e0", "#bdd72d", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"],
    tooltip: "Colors assigned to agents in cycle order. When there are more agents than colors, the palette repeats from the start.",
    minItems: 1,
    validate: colorArrayValidator,
  },
  "graph.mainColor": {
    type: "string",
    defaultValue: "#003864",
    tooltip: "Color for the main session node — the central hub that spawns agents.",
    validate: hexColorValidator,
  },
  "graph.continuousSimulation": {
    type: "boolean",
    defaultValue: false,
    tooltip: "Keep the force simulation running so nodes float and react to new agents in real-time. When off, the graph settles once and freezes.",
  },
  "graph.linkDistance": {
    type: "number", defaultValue: 150, min: 50, max: 500,
    tooltip: "Target distance between connected nodes (px). Higher values spread the graph out; lower values pack it tighter.",
  },
  "graph.chargeStrength": {
    type: "number", defaultValue: -300, min: -1000, max: -10,
    tooltip: "Repulsion force between all nodes. More negative = nodes push apart harder, preventing overlap in dense graphs.",
  },
  "graph.collideRadius": {
    type: "number", defaultValue: 50, min: 10, max: 200,
    tooltip: "Minimum gap between node edges (px). Prevents nodes from overlapping regardless of other forces.",
  },
  "graph.alphaDecay": {
    type: "number", defaultValue: 0.05, min: 0.01, max: 0.5,
    tooltip: "How fast the simulation cools down. Lower = smoother settling but slower. Only affects initial layout when continuous simulation is off.",
  },
  "graph.linkThicknessMin": {
    type: "number", defaultValue: 1, min: 1, max: 10,
    tooltip: "Thinnest link width (px), for connections with the fewest events.",
  },
  "graph.linkThicknessMax": {
    type: "number", defaultValue: 10, min: 2, max: 30,
    tooltip: "Thickest link width (px), for connections with the most events. Must be greater than min.",
  },
  "graph.opacityDecayMinutes": {
    type: "number", defaultValue: 5, min: 1, max: 60,
    tooltip: "Minutes of inactivity before a link fades to 50% opacity. Higher values keep old connections visible longer.",
  },

  // --- Server ---
  "server.pollInterval": {
    type: "number", defaultValue: 1000, min: 100, max: 30000,
    tooltip: "How often to check for file changes (ms). Lower = faster updates but higher CPU usage. Only used when watch mode is set to polling.",
  },
  "server.stabilityThreshold": {
    type: "number", defaultValue: 200, min: 50, max: 5000,
    tooltip: "Wait this long after a file stops changing before processing it (ms). Prevents reading partially-written JSONL files.",
  },
  "server.writePollInterval": {
    type: "number", defaultValue: 100, min: 50, max: 2000,
    tooltip: "How often to check whether a file has finished writing (ms). Used during the stability wait period.",
  },

  // --- Display ---
  "display.maxLoadedEvents": {
    type: "number", defaultValue: 500, min: 50, max: 5000,
    tooltip: "Maximum events held in memory while scrolling. When this limit is exceeded, the oldest events are trimmed from the buffer to free memory. Higher values let you scroll further without reloading, but use more browser memory.",
  },
  "display.jumpStepSize": {
    type: "number", defaultValue: 50, min: 10, max: 500,
    tooltip: "Number of events to skip when clicking the +/- navigation buttons in the event table.",
  },
  "display.costPrecisionThreshold": {
    type: "number", defaultValue: 0.01, min: 0.001, max: 1.0,
    tooltip: "Costs below this amount show 4 decimal places (e.g. $0.0023); costs at or above show 2 (e.g. $1.50).",
  },
  "display.tokenKThreshold": {
    type: "number", defaultValue: 1000, min: 100, max: 10000,
    tooltip: "Token counts at or above this display with K suffix (e.g. 1.5K instead of 1500).",
  },
  "display.tokenMThreshold": {
    type: "number", defaultValue: 1000000, min: 100000, max: 10000000,
    tooltip: "Token counts at or above this display with M suffix (e.g. 2.3M instead of 2300000). Must be greater than K threshold.",
  },
  "display.timeAgoJustNow": {
    type: "number", defaultValue: 60, min: 5, max: 300,
    tooltip: "Seconds. Events newer than this show \"just now\" instead of a relative time.",
  },
  "display.timeAgoMinutes": {
    type: "number", defaultValue: 60, min: 10, max: 1440,
    tooltip: "Minutes. Events older than this switch from \"Xm ago\" to \"Xh ago\".",
  },
  "display.timeAgoHours": {
    type: "number", defaultValue: 24, min: 1, max: 168,
    tooltip: "Hours. Events older than this switch from \"Xh ago\" to \"Xd ago\".",
  },
  "display.traceRowHeight": {
    type: "number", defaultValue: 32, min: 16, max: 64,
    tooltip: "Height of each row in the trace waterfall view (px). Increase for readability, decrease to fit more rows on screen.",
  },
  "display.traceMinSpanWidth": {
    type: "number", defaultValue: 4, min: 1, max: 20,
    tooltip: "Minimum width for trace spans (px). Ensures very short events are still visible and clickable.",
  },
  "display.traceLabelWidth": {
    type: "number", defaultValue: 160, min: 80, max: 300,
    tooltip: "Width of the agent name column in trace view (px). Increase if agent names are being truncated.",
  },
};

export function getDefault(key: string): any {
  return SETTINGS_REGISTRY[key]?.defaultValue;
}

export function getDefaults(): Record<string, any> {
  const defaults: Record<string, any> = {};
  for (const [key, def] of Object.entries(SETTINGS_REGISTRY)) {
    defaults[key] = def.defaultValue;
  }
  return defaults;
}

export function validateSetting(key: string, value: any): ValidationResult {
  const def = SETTINGS_REGISTRY[key];
  if (!def) return { valid: false, error: `Unknown setting: ${key}` };

  // Custom validator takes priority
  if (def.validate) return def.validate(value);

  // Type-specific validation
  switch (def.type) {
    case "number":
      if (typeof value !== "number" || isNaN(value))
        return { valid: false, error: "Must be a number" };
      if (def.min != null && value < def.min)
        return { valid: false, error: `Must be at least ${def.min}` };
      if (def.max != null && value > def.max)
        return { valid: false, error: `Must be at most ${def.max}` };
      return { valid: true };
    case "boolean":
      if (typeof value !== "boolean")
        return { valid: false, error: "Must be true or false" };
      return { valid: true };
    case "string":
      if (typeof value !== "string")
        return { valid: false, error: "Must be a string" };
      return { valid: true };
    case "string[]":
      if (!Array.isArray(value))
        return { valid: false, error: "Must be an array" };
      if (def.minItems != null && value.length < def.minItems)
        return { valid: false, error: `Must have at least ${def.minItems} item(s)` };
      return { valid: true };
    default:
      return { valid: true };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/server/settings-defaults.test.ts`
Expected: All 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/settings-defaults.ts test/server/settings-defaults.test.ts
git commit -m "feat: add settings defaults registry with validation"
```

---

### Task 2: Settings DB Layer

**Files:**
- Create: `src/server/db/settings.ts`
- Modify: `src/server/db/schema.ts:4-81` (add settings table)
- Test: `test/server/settings-db.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/server/settings-db.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/server/db/schema";
import {
  getAllSettings,
  getSetting,
  upsertSettings,
  deleteSettings,
  deleteAllSettings,
} from "../../src/server/db/settings";

describe("settings DB", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
  });

  test("getAllSettings returns empty object when no overrides", () => {
    expect(getAllSettings(db)).toEqual({});
  });

  test("upsertSettings writes and getSetting reads", () => {
    upsertSettings(db, { "graph.linkDistance": 200 });
    expect(getSetting(db, "graph.linkDistance")).toBe(200);
  });

  test("upsertSettings handles multiple keys", () => {
    upsertSettings(db, {
      "graph.linkDistance": 200,
      "server.pollInterval": 2000,
    });
    const all = getAllSettings(db);
    expect(all["graph.linkDistance"]).toBe(200);
    expect(all["server.pollInterval"]).toBe(2000);
  });

  test("upsertSettings overwrites existing value", () => {
    upsertSettings(db, { "graph.linkDistance": 200 });
    upsertSettings(db, { "graph.linkDistance": 300 });
    expect(getSetting(db, "graph.linkDistance")).toBe(300);
  });

  test("upsertSettings stores complex JSON values", () => {
    const colors = ["#ff0000", "#00ff00", "#0000ff"];
    upsertSettings(db, { "graph.agentColors": colors });
    expect(getSetting(db, "graph.agentColors")).toEqual(colors);
  });

  test("deleteSettings removes specific keys", () => {
    upsertSettings(db, { "graph.linkDistance": 200, "server.pollInterval": 2000 });
    deleteSettings(db, ["graph.linkDistance"]);
    expect(getSetting(db, "graph.linkDistance")).toBeNull();
    expect(getSetting(db, "server.pollInterval")).toBe(2000);
  });

  test("deleteAllSettings clears all settings", () => {
    upsertSettings(db, { "graph.linkDistance": 200, "server.pollInterval": 2000 });
    deleteAllSettings(db);
    expect(getAllSettings(db)).toEqual({});
  });

  test("getSetting returns null for missing key", () => {
    expect(getSetting(db, "nonexistent")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/server/settings-db.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Add settings table to schema**

In `src/server/db/schema.ts`, add after the `ingest_cursors` table and before the indexes:

```typescript
    CREATE TABLE IF NOT EXISTS settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TEXT DEFAULT (datetime('now'))
    );
```

- [ ] **Step 4: Write settings DB queries**

```typescript
// src/server/db/settings.ts
import type { Database } from "bun:sqlite";

export function getAllSettings(db: Database): Record<string, any> {
  const rows = db.query("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const result: Record<string, any> = {};
  for (const row of rows) {
    try { result[row.key] = JSON.parse(row.value); } catch { result[row.key] = row.value; }
  }
  return result;
}

export function getSetting(db: Database, key: string): any {
  const row = db.query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export function upsertSettings(db: Database, updates: Record<string, any>): void {
  const stmt = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  );
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(updates)) {
      stmt.run(key, JSON.stringify(value));
    }
  });
  tx();
}

export function deleteSettings(db: Database, keys: string[]): void {
  const placeholders = keys.map(() => "?").join(", ");
  db.run(`DELETE FROM settings WHERE key IN (${placeholders})`, keys);
}

export function deleteAllSettings(db: Database): void {
  db.run("DELETE FROM settings");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test test/server/settings-db.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/db/schema.ts src/server/db/settings.ts test/server/settings-db.test.ts
git commit -m "feat: add settings table and DB queries"
```

---

### Task 3: Settings API Endpoints

**Files:**
- Create: `src/server/api/settings.ts`
- Modify: `src/server/index.ts:1-62` (mount settings routes)
- Test: `test/server/settings-api.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/server/settings-api.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { applySchema } from "../../src/server/db/schema";
import { createSettingsRoutes } from "../../src/server/api/settings";

describe("Settings API", () => {
  let db: Database;
  let app: Hono;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    app = new Hono();
    createSettingsRoutes(app, db);
  });

  test("GET /api/settings returns defaults when no overrides", async () => {
    const res = await app.request("/api/settings");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body["graph.linkDistance"]).toBe(150);
    expect(body["server.pollInterval"]).toBe(1000);
    expect(body["pricing.models"]).toBeDefined();
  });

  test("PUT /api/settings stores and returns merged values", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "graph.linkDistance": 200 }),
    });
    expect(res.status).toBe(200);

    const get = await app.request("/api/settings");
    const body = await get.json();
    expect(body["graph.linkDistance"]).toBe(200);
    // Other defaults still present
    expect(body["server.pollInterval"]).toBe(1000);
  });

  test("PUT /api/settings rejects invalid values", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "graph.linkDistance": 9999 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.key).toBe("graph.linkDistance");
  });

  test("PUT /api/settings rejects unknown keys", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "unknown.key": 42 }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/settings/reset deletes specific keys", async () => {
    // Set a value
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "graph.linkDistance": 200, "server.pollInterval": 2000 }),
    });

    // Reset only linkDistance
    const res = await app.request("/api/settings/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: ["graph.linkDistance"] }),
    });
    expect(res.status).toBe(200);

    const get = await app.request("/api/settings");
    const body = await get.json();
    expect(body["graph.linkDistance"]).toBe(150); // back to default
    expect(body["server.pollInterval"]).toBe(2000); // still overridden
  });

  test("POST /api/settings/reset with no keys resets all", async () => {
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "graph.linkDistance": 200 }),
    });

    await app.request("/api/settings/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const get = await app.request("/api/settings");
    const body = await get.json();
    expect(body["graph.linkDistance"]).toBe(150);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/server/settings-api.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the API route handler**

```typescript
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

    return c.json({ ok: true });
  });
}
```

- [ ] **Step 4: Add `invalidatePricingCache` to shared pricing**

In `src/shared/pricing.ts`, add at the bottom:

```typescript
// Cache invalidation hook — called when settings change pricing
let _pricingDirty = false;

export function invalidatePricingCache(): void {
  _pricingDirty = true;
}

export function isPricingDirty(): boolean {
  return _pricingDirty;
}

export function clearPricingDirty(): void {
  _pricingDirty = false;
}
```

- [ ] **Step 5: Mount settings routes in server index**

In `src/server/index.ts`, add import:
```typescript
import { createSettingsRoutes } from "./api/settings";
```

Add after other route registrations (after line 29):
```typescript
createSettingsRoutes(app, db);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test test/server/settings-api.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 7: Run all tests to verify no regressions**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/server/api/settings.ts src/shared/pricing.ts src/server/index.ts test/server/settings-api.test.ts
git commit -m "feat: add settings API endpoints (GET, PUT, POST reset)"
```

---

### Task 4: Pricing Cache Integration

**Files:**
- Modify: `src/shared/pricing.ts:1-84` (add DB-aware pricing loader)
- Modify: `src/server/ingestion/processor.ts:4` (use settings-aware pricing)
- Modify: `src/server/index.ts` (load pricing from DB on startup)
- Test: `test/server/pricing-settings.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/server/pricing-settings.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/server/db/schema";
import { upsertSettings } from "../../src/server/db/settings";
import {
  loadPricingFromSettings,
  getModelPricing,
  calculateCost,
  invalidatePricingCache,
} from "../../src/shared/pricing";

describe("pricing with settings", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    invalidatePricingCache(); // reset state
  });

  test("loadPricingFromSettings merges DB pricing over defaults", () => {
    upsertSettings(db, {
      "pricing.models": {
        "claude-opus-4-6": { inputPerMToken: 20, outputPerMToken: 80, cacheReadPerMToken: 2, cacheWritePerMToken: 20 },
        "custom-model": { inputPerMToken: 1, outputPerMToken: 5, cacheReadPerMToken: 0.1, cacheWritePerMToken: 0.5 },
      },
    });

    loadPricingFromSettings(db);

    // Overridden model
    const opus = getModelPricing("claude-opus-4-6");
    expect(opus?.inputPerMToken).toBe(20);

    // Custom model
    const custom = getModelPricing("custom-model");
    expect(custom).not.toBeNull();
    expect(custom?.inputPerMToken).toBe(1);
  });

  test("calculateCost uses loaded pricing", () => {
    upsertSettings(db, {
      "pricing.models": {
        "test-model": { inputPerMToken: 10, outputPerMToken: 50, cacheReadPerMToken: 1, cacheWritePerMToken: 5 },
      },
    });
    loadPricingFromSettings(db);

    const cost = calculateCost("test-model", {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    expect(cost).toBe(10);
  });

  test("loadPricingFromSettings with no DB override uses defaults", () => {
    loadPricingFromSettings(db);
    const sonnet = getModelPricing("claude-sonnet-4-6");
    expect(sonnet?.inputPerMToken).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/server/pricing-settings.test.ts`
Expected: FAIL — `loadPricingFromSettings` not found

- [ ] **Step 3: Add `loadPricingFromSettings` to shared/pricing.ts**

Add to `src/shared/pricing.ts` (keep all existing exports, add new ones):

```typescript
import type { Database } from "bun:sqlite";
import { getSetting } from "../server/db/settings";

// Default pricing (existing PRICING constant stays as-is)
const DEFAULT_PRICING = { ...PRICING };

/**
 * Load pricing from settings DB, merging over defaults.
 * Called on server startup and when pricing cache is invalidated.
 */
export function loadPricingFromSettings(db: Database): void {
  const dbPricing = getSetting(db, "pricing.models");
  // Reset to defaults first
  for (const key of Object.keys(PRICING)) delete PRICING[key];
  Object.assign(PRICING, DEFAULT_PRICING);
  // Merge DB overrides
  if (dbPricing && typeof dbPricing === "object") {
    Object.assign(PRICING, dbPricing);
  }
  clearPricingDirty();
}
```

Note: The import of `Database` and `getSetting` is server-only. Since this module is shared, the `loadPricingFromSettings` function is only called server-side. The frontend uses `getModelPricing` with a client-side pricing object loaded from the settings API. To keep the shared module clean, we conditionally import — or alternatively, accept `db` as a parameter and have the caller read the setting:

Actually, cleaner approach — keep `loadPricingFromSettings` in a separate server-only file:

```typescript
// src/server/db/pricing-loader.ts
import type { Database } from "bun:sqlite";
import { getSetting } from "./settings";
import { PRICING, clearPricingDirty } from "../../shared/pricing";

const DEFAULT_PRICING = { ...PRICING };

export function loadPricingFromSettings(db: Database): void {
  const dbPricing = getSetting(db, "pricing.models");
  for (const key of Object.keys(PRICING)) delete PRICING[key];
  Object.assign(PRICING, DEFAULT_PRICING);
  if (dbPricing && typeof dbPricing === "object") {
    Object.assign(PRICING, dbPricing);
  }
  clearPricingDirty();
}
```

Update `src/shared/pricing.ts` to export `PRICING` as mutable (it already is — `Record<string, ModelPricing>`).

- [ ] **Step 4: Call loadPricingFromSettings on server startup**

In `src/server/index.ts`, add after `const db = getDb(...)`:

```typescript
import { loadPricingFromSettings } from "./db/pricing-loader";

// Load custom pricing from settings DB
loadPricingFromSettings(db);
```

- [ ] **Step 5: Update test imports to use server-only loader**

Update `test/server/pricing-settings.test.ts` to import `loadPricingFromSettings` from `../../src/server/db/pricing-loader`.

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test test/server/pricing-settings.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 7: Run all tests**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/server/db/pricing-loader.ts src/shared/pricing.ts src/server/index.ts test/server/pricing-settings.test.ts
git commit -m "feat: add settings-aware pricing with DB loader and cache invalidation"
```

---

### Task 5: React Settings Context

**Files:**
- Create: `src/client/contexts/SettingsContext.tsx`
- Modify: `src/client/App.tsx:1-6` (wrap with provider)
- Modify: `src/client/lib/api.ts:1-31` (add settings API methods)

- [ ] **Step 1: Add settings methods to api.ts**

In `src/client/lib/api.ts`, add to the `api` object:

```typescript
settings: {
  get: () => get<Record<string, any>>("/settings"),
  update: async (updates: Record<string, any>) => {
    const res = await fetch(`${BASE}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `API error: ${res.status}`);
    }
    return res.json();
  },
  reset: async (keys?: string[]) => {
    const res = await fetch(`${BASE}/settings/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },
},
```

- [ ] **Step 2: Create SettingsContext**

```typescript
// src/client/contexts/SettingsContext.tsx
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { api } from "../lib/api";
import { getDefaults } from "@shared/settings-defaults";

interface SettingsContextValue {
  settings: Record<string, any>;
  updateSettings: (updates: Record<string, any>) => Promise<void>;
  resetSettings: (keys?: string[]) => Promise<void>;
  isLoading: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Record<string, any>>(getDefaults());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api.settings.get()
      .then(setSettings)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  const updateSettings = useCallback(async (updates: Record<string, any>) => {
    const merged = await api.settings.update(updates);
    setSettings(merged);
  }, []);

  const resetSettings = useCallback(async (keys?: string[]) => {
    await api.settings.reset(keys);
    const fresh = await api.settings.get();
    setSettings(fresh);
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, resetSettings, isLoading }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
```

- [ ] **Step 3: Wrap App with SettingsProvider**

Replace `src/client/App.tsx`:

```typescript
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { SettingsProvider } from "./contexts/SettingsContext";

export function App() {
  return (
    <SettingsProvider>
      <RouterProvider router={router} />
    </SettingsProvider>
  );
}
```

- [ ] **Step 4: Verify dev server starts without errors**

Run: `bun run dev:client`
Expected: Compiles without errors, app loads, settings fetched from API

- [ ] **Step 5: Commit**

```bash
git add src/client/contexts/SettingsContext.tsx src/client/App.tsx src/client/lib/api.ts
git commit -m "feat: add SettingsContext with provider and useSettings hook"
```

---

### Task 6: Settings Page with Tab Navigation

**Files:**
- Create: `src/client/pages/SettingsPage.tsx`
- Modify: `src/client/router.tsx:1-18` (add /settings route)
- Modify: `src/client/components/layout/Shell.tsx:1-46` (add nav item)

- [ ] **Step 1: Create SettingsPage with tab shell**

```typescript
// src/client/pages/SettingsPage.tsx
import { useState } from "react";
import { PricingTab } from "../components/settings/PricingTab";
import { GraphTab } from "../components/settings/GraphTab";
import { ServerTab } from "../components/settings/ServerTab";
import { DisplayTab } from "../components/settings/DisplayTab";

const TABS = ["Model Pricing", "Agent Graph", "Server", "Display"] as const;
type Tab = (typeof TABS)[number];

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("Model Pricing");

  return (
    <div>
      <h1 className="text-xl font-bold text-primary-dark mb-5">Settings</h1>

      {/* Tab bar */}
      <div className="flex border-b-2 border-border mb-6">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              t === tab
                ? "px-4 py-2 text-sm font-semibold text-primary border-b-2 border-primary -mb-[2px]"
                : "px-4 py-2 text-sm text-muted hover:text-primary-dark"
            }
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "Model Pricing" && <PricingTab />}
      {tab === "Agent Graph" && <GraphTab />}
      {tab === "Server" && <ServerTab />}
      {tab === "Display" && <DisplayTab />}
    </div>
  );
}
```

- [ ] **Step 2: Create placeholder tab components**

Create 4 placeholder files so the imports resolve. Each follows the same pattern:

```typescript
// src/client/components/settings/PricingTab.tsx
export function PricingTab() {
  return <div className="text-muted text-sm">Pricing settings coming soon...</div>;
}
```

```typescript
// src/client/components/settings/GraphTab.tsx
export function GraphTab() {
  return <div className="text-muted text-sm">Graph settings coming soon...</div>;
}
```

```typescript
// src/client/components/settings/ServerTab.tsx
export function ServerTab() {
  return <div className="text-muted text-sm">Server settings coming soon...</div>;
}
```

```typescript
// src/client/components/settings/DisplayTab.tsx
export function DisplayTab() {
  return <div className="text-muted text-sm">Display settings coming soon...</div>;
}
```

- [ ] **Step 3: Add route to router.tsx**

In `src/client/router.tsx`, add import:
```typescript
import { SettingsPage } from "./pages/SettingsPage";
```

Add to children array (after the `/raw` route):
```typescript
{ path: "/settings", element: <SettingsPage /> },
```

- [ ] **Step 4: Add nav item to Shell.tsx**

In `src/client/components/layout/Shell.tsx`, add to the `navItems` array:

```typescript
{ to: "/settings", label: "Settings", icon: "M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z M12 8a4 4 0 100 8 4 4 0 000-8z" },
```

- [ ] **Step 5: Verify the page renders**

Run: `bun run dev:client`
Navigate to `/settings`. Expected: page loads with 4 tabs, placeholder content shown, Settings nav item is active.

- [ ] **Step 6: Commit**

```bash
git add src/client/pages/SettingsPage.tsx src/client/components/settings/ src/client/router.tsx src/client/components/layout/Shell.tsx
git commit -m "feat: add settings page with tab navigation and sidebar link"
```

---

### Task 7: Pricing Tab

**Files:**
- Modify: `src/client/components/settings/PricingTab.tsx`

- [ ] **Step 1: Implement PricingTab**

Replace the placeholder with the full implementation. The tab reads `pricing.models` from settings context, renders an editable card per model with 4 rate inputs, and supports add/remove. See the spec for UI details. Key elements:

- Read `settings["pricing.models"]` via `useSettings()`
- Local state for edits (clone on mount, diff on save)
- "Add Model" button: text input for model name + 4 rate inputs with defaults of 0
- "Remove" link per model
- Save button calls `updateSettings({ "pricing.models": localModels })`
- Reset button calls `resetSettings(["pricing.models"])`
- Tooltip on section header: from `SETTINGS_REGISTRY["pricing.models"].tooltip`
- Validation: all rates >= 0, model names non-empty and unique
- Inline error display on invalid values

- [ ] **Step 2: Verify in browser**

Run: `bun run dev:client`, navigate to `/settings`, Pricing tab.
Expected: 3 model cards with editable rates, + Add Model button, Save/Reset buttons.

- [ ] **Step 3: Commit**

```bash
git add src/client/components/settings/PricingTab.tsx
git commit -m "feat: implement pricing tab with add/edit/remove models"
```

---

### Task 8: Graph Tab

**Files:**
- Modify: `src/client/components/settings/GraphTab.tsx`

- [ ] **Step 1: Implement GraphTab**

Replace placeholder. Key elements:

- **Agent Colors section**: row of color swatches rendered from `settings["graph.agentColors"]`. Each swatch wraps a hidden `<input type="color">` that opens on click. "X" button to remove (disabled if only 1 left). "+" button to add a new color (defaults to a random hex). Tooltip from registry.
- **Main Color**: single swatch + hex input for `graph.mainColor`
- **Continuous Simulation**: toggle switch for `graph.continuousSimulation`
- **Force Simulation section**: 4 sliders/number inputs for `linkDistance`, `chargeStrength`, `collideRadius`, `alphaDecay`. Each shows current value, has min/max from registry, and tooltip on hover (info icon with `title` attribute).
- **Links section**: 3 inputs for `linkThicknessMin`, `linkThicknessMax`, `opacityDecayMinutes`
- Save/Reset buttons at bottom

- [ ] **Step 2: Verify in browser**

Navigate to `/settings` > Agent Graph tab.
Expected: color swatches with +/remove, toggle for continuous sim, sliders for force params, link settings.

- [ ] **Step 3: Commit**

```bash
git add src/client/components/settings/GraphTab.tsx
git commit -m "feat: implement graph tab with colors, simulation, and link settings"
```

---

### Task 9: Server Tab

**Files:**
- Modify: `src/client/components/settings/ServerTab.tsx`

- [ ] **Step 1: Implement ServerTab**

Replace placeholder. Key elements:

- Yellow warning banner at top: "Server settings require a restart to take effect."
- 3 number inputs: `server.pollInterval`, `server.stabilityThreshold`, `server.writePollInterval`
- Each input has min/max from registry, tooltip on info icon
- Save/Reset buttons
- Simple layout — these are all just number inputs with labels

- [ ] **Step 2: Verify in browser**

Navigate to `/settings` > Server tab.
Expected: warning banner, 3 inputs with labels and tooltips, save/reset buttons.

- [ ] **Step 3: Commit**

```bash
git add src/client/components/settings/ServerTab.tsx
git commit -m "feat: implement server tab with polling and watcher settings"
```

---

### Task 10: Display Tab

**Files:**
- Modify: `src/client/components/settings/DisplayTab.tsx`

- [ ] **Step 1: Implement DisplayTab**

Replace placeholder. Key elements:

- **Event Loading** section: `maxLoadedEvents`, `jumpStepSize`
- **Number Formatting** section: `costPrecisionThreshold`, `tokenKThreshold`, `tokenMThreshold`
- **Time Display** section: `timeAgoJustNow`, `timeAgoMinutes`, `timeAgoHours`
- **Trace View Layout** section: `traceRowHeight`, `traceMinSpanWidth`, `traceLabelWidth`
- All inputs have min/max from registry, tooltips
- Save/Reset buttons

- [ ] **Step 2: Verify in browser**

Navigate to `/settings` > Display tab.
Expected: 4 sections with labeled inputs, tooltips, save/reset buttons.

- [ ] **Step 3: Commit**

```bash
git add src/client/components/settings/DisplayTab.tsx
git commit -m "feat: implement display tab with formatting and layout settings"
```

---

### Task 11: Wire Components to Settings Context — Graph Components

**Files:**
- Modify: `src/client/components/AgentGraph.tsx:7-8,183-189,224,336,342-349`
- Modify: `src/client/components/AgentTimeline.tsx:8-9,98`
- Modify: `src/client/components/TraceView.tsx:7-10,78`

- [ ] **Step 1: Update AgentGraph to use settings**

In `src/client/components/AgentGraph.tsx`:

1. Add import: `import { useSettings } from "../contexts/SettingsContext";`
2. Inside `AgentGraph` function, add: `const { settings } = useSettings();`
3. Replace `AGENT_COLORS` constant with `const AGENT_COLORS = settings["graph.agentColors"];`
4. Replace `MAIN_COLOR` constant with `const MAIN_COLOR = settings["graph.mainColor"];`
5. Replace force simulation hardcoded values:
   - `.distance(150)` → `.distance(settings["graph.linkDistance"])`
   - `.strength(-300)` → `.strength(settings["graph.chargeStrength"])`
   - `.forceCollide(50)` → `.forceCollide(settings["graph.collideRadius"])`
   - `.alphaDecay(0.05)` → `.alphaDecay(settings["graph.alphaDecay"])`
6. Replace link thickness: use `settings["graph.linkThicknessMin"]` and `settings["graph.linkThicknessMax"]`
7. Replace opacity decay: use `settings["graph.opacityDecayMinutes"]`
8. Add continuous simulation support: when `settings["graph.continuousSimulation"]` is true, set `alphaMin(0)` and `alphaTarget(0.01)` on the simulation. Remove the `simulation.on("end", ...)` handler when continuous — use only tick updates.
9. Remove the top-level `const AGENT_COLORS` and `const MAIN_COLOR` constants.

- [ ] **Step 2: Update AgentTimeline**

In `src/client/components/AgentTimeline.tsx`:

1. Add import: `import { useSettings } from "../contexts/SettingsContext";`
2. Inside `AgentTimeline`, add: `const { settings } = useSettings();`
3. Replace `AGENT_COLORS` and `MAIN_COLOR` constants with settings reads.
4. Remove the top-level constants.

- [ ] **Step 3: Update TraceView**

In `src/client/components/TraceView.tsx`:

1. Add import: `import { useSettings } from "../contexts/SettingsContext";`
2. Inside `TraceView`, add: `const { settings } = useSettings();`
3. Replace `AGENT_COLORS`, `ROW_HEIGHT`, `LABEL_WIDTH`, `MIN_SPAN_WIDTH` with settings reads.
4. Remove the top-level constants.

- [ ] **Step 4: Verify in browser**

Open a session with agents. Verify the graph, timeline, and trace view render correctly with default colors and layout. Then change colors in settings and verify they update live.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/AgentGraph.tsx src/client/components/AgentTimeline.tsx src/client/components/TraceView.tsx
git commit -m "feat: wire graph components to settings context for colors and simulation"
```

---

### Task 12: Wire Components to Settings Context — Display Components

**Files:**
- Modify: `src/client/lib/utils.ts:1-37`
- Modify: `src/client/components/EventTable.tsx:362-363`
- Modify: `src/client/hooks/useInfiniteEvents.ts:34`
- Modify: `src/client/components/CostBreakdownPanel.tsx:4`

- [ ] **Step 1: Add optional threshold params to utils.ts**

Update `formatTokens`, `formatCost`, and `timeAgo` to accept optional threshold parameters:

```typescript
interface FormatOptions {
  kThreshold?: number;
  mThreshold?: number;
  costPrecisionThreshold?: number;
  timeAgoJustNow?: number;
  timeAgoMinutes?: number;
  timeAgoHours?: number;
}

export function formatTokens(n: number | null | undefined, opts?: FormatOptions): string {
  if (n == null) return "—";
  const mThreshold = opts?.mThreshold ?? 1_000_000;
  const kThreshold = opts?.kThreshold ?? 1_000;
  if (n >= mThreshold) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= kThreshold) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export function formatCost(usd: number | null | undefined, opts?: FormatOptions): string {
  if (usd == null) return "—";
  const threshold = opts?.costPrecisionThreshold ?? 0.01;
  if (usd < threshold) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function timeAgo(dateStr: string, opts?: FormatOptions): string {
  const justNowSec = opts?.timeAgoJustNow ?? 60;
  const minutesThreshold = opts?.timeAgoMinutes ?? 60;
  const hoursThreshold = opts?.timeAgoHours ?? 24;

  const normalized = dateStr.includes("T") ? dateStr : dateStr.replace(" ", "T") + "Z";
  const diff = Date.now() - new Date(normalized).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < justNowSec) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < minutesThreshold) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < hoursThreshold) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
```

These are backward-compatible — existing callers without options continue to work with defaults.

- [ ] **Step 2: Update EventTable jump step**

In `src/client/components/EventTable.tsx`:

1. Add import: `import { useSettings } from "../contexts/SettingsContext";`
2. Inside `EventTable`, add: `const { settings } = useSettings();`
3. Replace hardcoded `50` in jump buttons with `settings["display.jumpStepSize"]`:
   - `Math.min(total, (maxVisible) + 50)` → `Math.min(total, (maxVisible) + settings["display.jumpStepSize"])`
   - `Math.max(1, (minVisible) - 50)` → `Math.max(1, (minVisible) - settings["display.jumpStepSize"])`
   - Button labels: `+50` → `+${settings["display.jumpStepSize"]}`, same for `-50`

- [ ] **Step 3: Update useInfiniteEvents maxLoadedEvents**

In `src/client/hooks/useInfiniteEvents.ts`, the hook currently uses a module-level constant `MAX_LOADED_EVENTS = 500`. Since hooks can't use `useSettings` at the module level, pass it as an option:

1. Add `maxLoadedEvents?: number` to `UseInfiniteEventsOptions`
2. Replace `MAX_LOADED_EVENTS` references with `options.maxLoadedEvents ?? 500`
3. Remove the `const MAX_LOADED_EVENTS = 500` line
4. In `AgentTimeline.tsx` where the hook is called, pass `maxLoadedEvents: settings["display.maxLoadedEvents"]`

- [ ] **Step 4: Update CostBreakdownPanel pricing source**

In `src/client/components/CostBreakdownPanel.tsx`:

1. Add import: `import { useSettings } from "../contexts/SettingsContext";`
2. Inside `CostBreakdownPanel`, add: `const { settings } = useSettings();`
3. Replace `getModelPricing(m.model)` calls with a local lookup function that reads from `settings["pricing.models"]`:

```typescript
const pricingModels = settings["pricing.models"];
const getSettingsPricing = (model: string) => {
  if (pricingModels[model]) return pricingModels[model];
  const base = model.replace(/-\d{8}$/, "");
  return pricingModels[base] ?? null;
};
```

Replace all `getModelPricing(...)` calls in the component with `getSettingsPricing(...)`.

- [ ] **Step 5: Verify in browser**

- Check EventTable jump buttons show configurable step size
- Check cost formatting respects settings
- Change display settings, verify they apply live

- [ ] **Step 6: Run all tests**

Run: `bun test`
Expected: All tests PASS (utils changes are backward-compatible)

- [ ] **Step 7: Commit**

```bash
git add src/client/lib/utils.ts src/client/components/EventTable.tsx src/client/hooks/useInfiniteEvents.ts src/client/components/CostBreakdownPanel.tsx src/client/components/AgentTimeline.tsx
git commit -m "feat: wire display components to settings context"
```

---

### Task 13: Wire Server Settings on Startup

**Files:**
- Modify: `src/server/ingestion/watcher.ts:18-41`
- Modify: `src/server/index.ts:50-56`

- [ ] **Step 1: Read server settings from DB on startup**

In `src/server/index.ts`, after `loadPricingFromSettings(db)`:

```typescript
import { getSetting } from "./db/settings";

// Load server settings from DB (env vars take precedence)
const dbPollInterval = getSetting(db, "server.pollInterval");
const dbStabilityThreshold = getSetting(db, "server.stabilityThreshold");
const dbWritePollInterval = getSetting(db, "server.writePollInterval");

const effectivePollInterval = process.env.CT_POLL_INTERVAL != null ? config.pollInterval : (dbPollInterval ?? config.pollInterval);
const effectiveStabilityThreshold = dbStabilityThreshold ?? 200;
const effectiveWritePollInterval = dbWritePollInterval ?? 100;
```

Note: We check `process.env.CT_POLL_INTERVAL != null` to detect if the env var was explicitly set. When set, env vars take precedence over DB settings.

- [ ] **Step 2: Pass effective values to watcher**

Update the `startWatcher` call and `WatcherConfig` interface to include `stabilityThreshold` and `writePollInterval`:

In `src/server/ingestion/watcher.ts`, extend `WatcherConfig`:
```typescript
interface WatcherConfig {
  projectsDir: string;
  watchMode: "auto" | "native" | "poll";
  pollInterval: number;
  stabilityThreshold: number;
  writePollInterval: number;
}
```

Replace the hardcoded chokidar `awaitWriteFinish` values:
```typescript
awaitWriteFinish: { stabilityThreshold: config.stabilityThreshold, pollInterval: config.writePollInterval },
```

Update the `startWatcher` call in `src/server/index.ts`:
```typescript
startWatcher(db, {
  projectsDir: config.projectsDir,
  watchMode: config.watchMode,
  pollInterval: effectivePollInterval,
  stabilityThreshold: effectiveStabilityThreshold,
  writePollInterval: effectiveWritePollInterval,
})
```

- [ ] **Step 3: Run all tests**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts src/server/ingestion/watcher.ts
git commit -m "feat: wire server settings from DB with env var precedence"
```

---

### Task 14: End-to-End Verification

**Files:** None (manual verification)

- [ ] **Step 1: Start dev servers**

Run: `bun run dev` and `bun run dev:client` in separate terminals.

- [ ] **Step 2: Verify settings page**

Navigate to `http://localhost:5173/settings`:
- All 4 tabs render with correct defaults
- Each input has a tooltip on hover (info icon or title attribute)
- Saving changes persists (refresh page, values remain)
- Reset to Defaults restores original values

- [ ] **Step 3: Verify pricing changes apply live**

1. Change Opus input rate to $20/M in settings
2. Trigger a new event (use Claude Code)
3. Verify the new event's cost uses the $20 rate

- [ ] **Step 4: Verify graph settings apply live**

1. Open a session with agents
2. Go to settings, change agent colors
3. Return to session — colors should update without refresh
4. Enable continuous simulation, verify graph keeps moving

- [ ] **Step 5: Verify display settings apply live**

1. Change jump step size to 100
2. Return to event table — +/- buttons should show 100
3. Change token K threshold to 5000
4. Return — tokens below 5000 should show raw numbers

- [ ] **Step 6: Run full test suite**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 7: Commit any fixes from verification**

Stage only the specific files that were fixed, then commit:

```bash
git commit -m "fix: end-to-end verification fixes for settings page"
```
