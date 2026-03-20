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
    expect(defaults["display.maxLoadedEvents"]).toBe(2000);
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
