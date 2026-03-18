// src/server/ingestion/pricing.ts

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

// Pricing as of March 2026 — update when new models launch
const PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-6": {
    inputPerMToken: 15,
    outputPerMToken: 75,
    cacheReadPerMToken: 1.5,
    cacheWritePerMToken: 18.75,
  },
  "claude-sonnet-4-6": {
    inputPerMToken: 3,
    outputPerMToken: 15,
    cacheReadPerMToken: 0.3,
    cacheWritePerMToken: 3.75,
  },
  "claude-haiku-4-5": {
    inputPerMToken: 0.80,
    outputPerMToken: 4,
    cacheReadPerMToken: 0.08,
    cacheWritePerMToken: 1,
  },
};

export function getModelPricing(model: string): ModelPricing | null {
  // Try exact match first
  if (PRICING[model]) return PRICING[model];
  // Try stripping date suffix (e.g., claude-sonnet-4-6-20260301 → claude-sonnet-4-6)
  const base = model.replace(/-\d{8}$/, "");
  return PRICING[base] ?? null;
}

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
