// src/server/db/pricing-loader.ts
import type { Database } from "bun:sqlite";
import { getSetting } from "./settings";
import { PRICING, clearPricingDirty, invalidatePricingCache } from "../../shared/pricing";

export function loadPricingFromSettings(db: Database): void {
  const dbPricing = getSetting(db, "pricing.models");
  // Reset to defaults first
  invalidatePricingCache();
  // Merge DB overrides
  if (dbPricing && typeof dbPricing === "object") {
    Object.assign(PRICING, dbPricing);
  }
  clearPricingDirty();
}
