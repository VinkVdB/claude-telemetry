// src/server/db/pricing-migration.ts
import type { Database } from "bun:sqlite";
import { PRICING_VERSION, calculateCost } from "../../shared/pricing";
import { getSetting } from "./settings";
import { updateSessionAggregates } from "./queries";

// Prefixed migration_ so getAllSettings() excludes it from the settings API surface.
const RECOMPUTE_KEY = "migration_pricing_recompute";

/**
 * Recompute stored cost aggregates when the pricing table has changed since the
 * last run. Session/project costs are derived from per-event tokens × pricing,
 * but sessions.total_cost_usd is only refreshed when a session receives a new
 * event — so a pricing change (e.g. adding a model that was previously $0)
 * leaves historical sessions stale until touched. This runs a one-time
 * re-aggregation, keyed to PRICING_VERSION, so it fires exactly once per
 * pricing change and is a no-op on every other startup.
 *
 * Recomputes purely from data already in the DB (event tokens) — it never reads
 * JSONL, so it is safe even for projects whose source logs are no longer on disk.
 *
 * MUST be called AFTER loadPricingFromSettings() so DB pricing overrides are
 * respected.
 */
export function recomputePricingIfChanged(db: Database): void {
  const stored = getSetting(db, RECOMPUTE_KEY);
  if (stored === PRICING_VERSION) return;

  const startedAt = performance.now();

  // 1) Refresh per-event stored cost_usd for every event with a model + tokens.
  //    (Aggregation below doesn't read this column, but keep it consistent for
  //    any consumer that does — e.g. the watcher's NULL-cost backfill.)
  const eventRows = db
    .query(
      `SELECT rowid, model,
              COALESCE(input_tokens,0)          AS input_tokens,
              COALESCE(output_tokens,0)         AS output_tokens,
              COALESCE(cache_read_tokens,0)     AS cache_read_tokens,
              COALESCE(cache_creation_tokens,0) AS cache_creation_tokens
       FROM events
       WHERE model IS NOT NULL`,
    )
    .all() as Array<{
    rowid: number;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  }>;

  const updateCost = db.prepare("UPDATE events SET cost_usd = ? WHERE rowid = ?");
  const recomputeEvents = db.transaction((rows: typeof eventRows) => {
    for (const row of rows) {
      const cost = calculateCost(row.model, {
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cacheReadTokens: row.cache_read_tokens,
        cacheCreationTokens: row.cache_creation_tokens,
      });
      updateCost.run(cost, row.rowid);
    }
  });
  recomputeEvents(eventRows);

  // 2) Re-aggregate every session (rebuilds session_costs + sessions.total_cost_usd
  //    using current pricing). Project card totals are SUM(sessions.total_cost_usd),
  //    so they refresh automatically once sessions are correct.
  const sessions = db.query("SELECT DISTINCT session_id FROM events").all() as {
    session_id: string;
  }[];
  const reaggregate = db.transaction((ids: typeof sessions) => {
    for (const { session_id } of ids) {
      updateSessionAggregates(db, session_id);
    }
  });
  reaggregate(sessions);

  db.run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [RECOMPUTE_KEY, JSON.stringify(PRICING_VERSION)],
  );

  const ms = Math.round(performance.now() - startedAt);
  console.log(
    `[pricing] Recomputed costs for ${sessions.length} session(s) / ${eventRows.length} event(s) ` +
      `after pricing change → version ${PRICING_VERSION} (${ms}ms)`,
  );
}
