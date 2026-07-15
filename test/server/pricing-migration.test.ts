// test/server/pricing-migration.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/server/db/schema";
import { upsertProject, upsertSession, insertEvent } from "../../src/server/db/queries";
import { recomputePricingIfChanged } from "../../src/server/db/pricing-migration";
import { invalidatePricingCache, PRICING_VERSION } from "../../src/shared/pricing";

/** Insert one priced assistant event, simulating a session ingested when the
 *  model was unpriced: stored per-event cost and session total left at 0. */
function seedStaleSession(db: Database, model: string) {
  upsertProject(db, "-proj", "proj", "/proj");
  upsertSession(db, "sess-1", "-proj", { startedAt: "2026-07-01T00:00:00Z" });
  insertEvent(db, {
    id: "evt-1",
    messageId: "msg-1",
    sessionId: "sess-1",
    type: "assistant",
    timestamp: "2026-07-01T00:00:00Z",
    model,
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0, // stale: computed as $0 when the model was unpriced
    raw: "{}",
  });
  // Session aggregate left at default 0 (as if never re-aggregated since ingest)
  db.run("UPDATE sessions SET total_cost_usd = 0 WHERE id = 'sess-1'");
}

describe("recomputePricingIfChanged", () => {
  let db: Database;
  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    invalidatePricingCache();
  });

  test("recomputes stale $0 session + event costs for a now-priced model", () => {
    seedStaleSession(db, "claude-opus-4-8");
    // Force the migration to fire (schema backfill may have already run for this DB).
    db.run("DELETE FROM settings WHERE key = 'migration_pricing_recompute'");

    recomputePricingIfChanged(db);

    // opus-4-8: 1M input @ $5 + 1M output @ $25 = $30
    const session = db.query("SELECT total_cost_usd FROM sessions WHERE id = 'sess-1'").get() as { total_cost_usd: number };
    expect(session.total_cost_usd).toBeCloseTo(30, 5);

    const event = db.query("SELECT cost_usd FROM events WHERE id = 'evt-1'").get() as { cost_usd: number };
    expect(event.cost_usd).toBeCloseTo(30, 5);
  });

  test("is a no-op when pricing version is unchanged", () => {
    seedStaleSession(db, "claude-opus-4-8");
    // Mark as already recomputed at the current version.
    db.run(
      "INSERT INTO settings (key, value) VALUES ('migration_pricing_recompute', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [JSON.stringify(PRICING_VERSION)],
    );

    recomputePricingIfChanged(db);

    // Left untouched because the version matched.
    const session = db.query("SELECT total_cost_usd FROM sessions WHERE id = 'sess-1'").get() as { total_cost_usd: number };
    expect(session.total_cost_usd).toBe(0);
  });

  test("records the current pricing version after running", () => {
    seedStaleSession(db, "claude-opus-4-8");
    db.run("DELETE FROM settings WHERE key = 'migration_pricing_recompute'");

    recomputePricingIfChanged(db);

    const row = db.query("SELECT value FROM settings WHERE key = 'migration_pricing_recompute'").get() as { value: string };
    expect(JSON.parse(row.value)).toBe(PRICING_VERSION);
  });
});
