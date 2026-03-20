// test/server/pricing-settings.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/server/db/schema";
import { upsertSettings } from "../../src/server/db/settings";
import { loadPricingFromSettings } from "../../src/server/db/pricing-loader";
import {
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
