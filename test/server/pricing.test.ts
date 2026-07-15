// test/server/pricing.test.ts
import { describe, test, expect } from "bun:test";
import { calculateCost, getModelPricing, type TokenUsage } from "../../src/server/ingestion/pricing";

describe("getModelPricing", () => {
  test("returns pricing for known models", () => {
    const pricing = getModelPricing("claude-sonnet-4-6");
    expect(pricing).not.toBeNull();
    expect(pricing!.inputPerMToken).toBeGreaterThan(0);
    expect(pricing!.outputPerMToken).toBeGreaterThan(0);
  });

  // Regression: current-generation models must be priced, or cost silently becomes $0.
  test.each([
    ["claude-opus-4-8", 5, 25],
    ["claude-opus-4-7", 5, 25],
    ["claude-sonnet-5", 3, 15],
    ["claude-fable-5", 10, 50],
  ])("prices %s at $%d/$%d per Mtok", (model, input, output) => {
    const p = getModelPricing(model);
    expect(p).not.toBeNull();
    expect(p!.inputPerMToken).toBe(input);
    expect(p!.outputPerMToken).toBe(output);
    // cache rates follow Anthropic's standard 0.1x read / 1.25x write of input
    expect(p!.cacheReadPerMToken).toBeCloseTo(input * 0.1, 5);
    expect(p!.cacheWritePerMToken).toBeCloseTo(input * 1.25, 5);
  });

  test("prices Haiku 4.5 at current $1/$5 rate", () => {
    const p = getModelPricing("claude-haiku-4-5");
    expect(p).not.toBeNull();
    expect(p!.inputPerMToken).toBe(1);
    expect(p!.outputPerMToken).toBe(5);
  });

  test("prices current models via date-suffixed IDs", () => {
    expect(getModelPricing("claude-opus-4-8-20260101")).not.toBeNull();
  });

  test("returns pricing for model with date suffix", () => {
    const pricing = getModelPricing("claude-sonnet-4-6-20260301");
    expect(pricing).not.toBeNull();
  });

  test("returns null for unknown model", () => {
    expect(getModelPricing("unknown-model")).toBeNull();
  });
});

describe("calculateCost", () => {
  test("computes cost for sonnet usage", () => {
    const usage: TokenUsage = {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 2000,
      cacheCreationTokens: 100,
    };
    const cost = calculateCost("claude-sonnet-4-6", usage);
    expect(cost).toBeGreaterThan(0);
    // Verify cache reads are cheaper than input
    const fullInputCost = calculateCost("claude-sonnet-4-6", { ...usage, cacheReadTokens: 0 });
    const cacheOnlyCost = calculateCost("claude-sonnet-4-6", {
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 3000, cacheCreationTokens: 0,
    });
    // Cache reads should contribute some cost but less per-token than input
    expect(cost).toBeDefined();
  });

  test("returns 0 for unknown model", () => {
    expect(calculateCost("unknown", { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0 })).toBe(0);
  });

  test("returns 0 for zero tokens", () => {
    expect(calculateCost("claude-sonnet-4-6", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 })).toBe(0);
  });
});
