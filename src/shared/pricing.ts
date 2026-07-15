// src/shared/pricing.ts — Single source of truth for model pricing

export interface ModelPricing {
  inputPerMToken: number;      // USD per 1M input tokens
  outputPerMToken: number;     // USD per 1M output tokens
  cacheReadPerMToken: number;  // USD per 1M cache-read tokens
  cacheWritePerMToken: number; // USD per 1M cache-creation tokens
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/**
 * Bump whenever DEFAULT_PRICING changes. The server uses this to decide whether
 * stored session/project cost aggregates need recomputing on startup (see
 * db/pricing-migration.ts). Changing a rate without bumping this leaves stale
 * cached costs in the DB.
 */
export const PRICING_VERSION = "2026-07-14";

/**
 * Default pricing, current as of July 2026 — update (and bump PRICING_VERSION)
 * when new models launch. Cache rates follow Anthropic's standard schedule:
 * cache-read = 0.1x input, cache-write (5-min) = 1.25x input.
 *
 * NOTE: Sonnet 5 has introductory pricing ($2/$10 through 2026-08-31); we use
 * the standard $3/$15 to keep a single durable rate (time-varying pricing is
 * not modeled here).
 */
export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  "claude-fable-5": {
    inputPerMToken: 10,
    outputPerMToken: 50,
    cacheReadPerMToken: 1,
    cacheWritePerMToken: 12.5,
  },
  "claude-opus-4-8": {
    inputPerMToken: 5,
    outputPerMToken: 25,
    cacheReadPerMToken: 0.5,
    cacheWritePerMToken: 6.25,
  },
  "claude-opus-4-7": {
    inputPerMToken: 5,
    outputPerMToken: 25,
    cacheReadPerMToken: 0.5,
    cacheWritePerMToken: 6.25,
  },
  "claude-opus-4-6": {
    inputPerMToken: 5,
    outputPerMToken: 25,
    cacheReadPerMToken: 0.5,
    cacheWritePerMToken: 6.25,
  },
  "claude-sonnet-5": {
    inputPerMToken: 3,
    outputPerMToken: 15,
    cacheReadPerMToken: 0.3,
    cacheWritePerMToken: 3.75,
  },
  "claude-sonnet-4-6": {
    inputPerMToken: 3,
    outputPerMToken: 15,
    cacheReadPerMToken: 0.3,
    cacheWritePerMToken: 3.75,
  },
  "claude-haiku-4-5": {
    inputPerMToken: 1,
    outputPerMToken: 5,
    cacheReadPerMToken: 0.1,
    cacheWritePerMToken: 1.25,
  },
};

/** Deep copy of the defaults so callers can't mutate the source of truth. */
function freshDefaults(): Record<string, ModelPricing> {
  const out: Record<string, ModelPricing> = {};
  for (const [model, rates] of Object.entries(DEFAULT_PRICING)) {
    out[model] = { ...rates };
  }
  return out;
}

// Live pricing table: starts as the defaults, may be overlaid with DB overrides
// via loadPricingFromSettings(). Kept as a mutable object so overrides merge in place.
export const PRICING: Record<string, ModelPricing> = freshDefaults();

/** Short type-name to ModelPricing key mapping */
const TYPE_TO_RATE: Record<string, keyof ModelPricing> = {
  input: "inputPerMToken",
  output: "outputPerMToken",
  cache_read: "cacheReadPerMToken",
  cache_write: "cacheWritePerMToken",
};

/**
 * Look up pricing for a model, stripping date suffix if needed.
 */
export function getModelPricing(model: string): ModelPricing | null {
  if (PRICING[model]) return PRICING[model];
  const base = model.replace(/-\d{8}$/, "");
  return PRICING[base] ?? null;
}

// Warn at most once per unpriced model so a $0 cost never passes silently.
const _warnedUnknownModels = new Set<string>();

/**
 * Emit a one-time warning if `model` has token usage but no pricing entry.
 * Call this at the ingestion boundary. Sentinel models like "<synthetic>"
 * (Claude Code internal, non-billable) are ignored.
 */
export function warnIfUnpriced(model: string | null | undefined): void {
  if (!model || model.startsWith("<")) return;
  if (getModelPricing(model)) return;
  if (_warnedUnknownModels.has(model)) return;
  _warnedUnknownModels.add(model);
  console.warn(
    `[pricing] No pricing entry for model "${model}" — its cost is recorded as $0. ` +
      `Add it to DEFAULT_PRICING in src/shared/pricing.ts (and bump PRICING_VERSION), ` +
      `or override it via the pricing settings.`,
  );
}

/**
 * Compute cost for a single token type using short names:
 * "input", "output", "cache_read", "cache_write".
 */
export function tokenTypeCost(model: string, type: string, tokens: number): number {
  const pricing = getModelPricing(model);
  if (!pricing) return 0;
  const rateKey = TYPE_TO_RATE[type];
  if (!rateKey) return 0;
  return (tokens / 1_000_000) * pricing[rateKey];
}

let _pricingDirty = false;

/** Mark pricing cache as dirty (needs reload from DB). */
export function markPricingDirty(): void { _pricingDirty = true; }

/** Clear pricing dirty flag after reload. */
export function clearPricingDirty(): void { _pricingDirty = false; }

/** Returns true if pricing has been changed and needs reload. */
export function isPricingDirty(): boolean { return _pricingDirty; }

/** Reset pricing cache to the built-in defaults (for testing and reload). */
export function invalidatePricingCache(): void {
  for (const key of Object.keys(PRICING)) delete (PRICING as any)[key];
  Object.assign(PRICING, freshDefaults());
  _pricingDirty = false;
}

/**
 * Compute total cost across all token types for a model.
 */
export function calculateCost(model: string, usage: TokenUsage): number {
  const pricing = getModelPricing(model);
  if (!pricing) return 0;

  const { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens } = usage;
  if (inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens === 0) return 0;

  return (
    (inputTokens / 1_000_000) * pricing.inputPerMToken +
    (outputTokens / 1_000_000) * pricing.outputPerMToken +
    (cacheReadTokens / 1_000_000) * pricing.cacheReadPerMToken +
    (cacheCreationTokens / 1_000_000) * pricing.cacheWritePerMToken
  );
}
