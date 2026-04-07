export interface SettingDefinition {
  type: "number" | "boolean" | "string" | "string[]" | "json";
  defaultValue: any;
  tooltip: string;
  min?: number;
  max?: number;
  minItems?: number;
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
  "pricing.models": {
    type: "json",
    defaultValue: {
      "claude-opus-4-6": { inputPerMToken: 5, outputPerMToken: 25, cacheReadPerMToken: 0.50, cacheWritePerMToken: 6.25 },
      "claude-opus-4-5": { inputPerMToken: 5, outputPerMToken: 25, cacheReadPerMToken: 0.50, cacheWritePerMToken: 6.25 },
      "claude-opus-4-1": { inputPerMToken: 15, outputPerMToken: 75, cacheReadPerMToken: 1.50, cacheWritePerMToken: 18.75 },
      "claude-opus-4": { inputPerMToken: 15, outputPerMToken: 75, cacheReadPerMToken: 1.50, cacheWritePerMToken: 18.75 },
      "claude-sonnet-4-6": { inputPerMToken: 3, outputPerMToken: 15, cacheReadPerMToken: 0.30, cacheWritePerMToken: 3.75 },
      "claude-sonnet-4-5": { inputPerMToken: 3, outputPerMToken: 15, cacheReadPerMToken: 0.30, cacheWritePerMToken: 3.75 },
      "claude-sonnet-4": { inputPerMToken: 3, outputPerMToken: 15, cacheReadPerMToken: 0.30, cacheWritePerMToken: 3.75 },
      "claude-sonnet-3-7": { inputPerMToken: 3, outputPerMToken: 15, cacheReadPerMToken: 0.30, cacheWritePerMToken: 3.75 },
      "claude-haiku-4-5": { inputPerMToken: 1, outputPerMToken: 5, cacheReadPerMToken: 0.10, cacheWritePerMToken: 1.25 },
      "claude-haiku-3-5": { inputPerMToken: 0.80, outputPerMToken: 4, cacheReadPerMToken: 0.08, cacheWritePerMToken: 1.00 },
      "claude-opus-3": { inputPerMToken: 15, outputPerMToken: 75, cacheReadPerMToken: 1.50, cacheWritePerMToken: 18.75 },
      "claude-haiku-3": { inputPerMToken: 0.25, outputPerMToken: 1.25, cacheReadPerMToken: 0.03, cacheWritePerMToken: 0.30 },
    },
    tooltip: "USD per 1M tokens. Changes apply to new events only — existing costs are not recalculated.",
    validate: pricingValidator,
  },
  "graph.maxEvents": {
    type: "number", defaultValue: 2500, min: 100, max: 50000,
    tooltip: "Maximum number of events loaded for the Graph & Trace view. Lower values are faster to render; raise this if you want to see more history.",
  },
  "graph.agentColors": {
    type: "string[]",
    defaultValue: ["#00a2e0", "#bdd72d", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"],
    tooltip: "Colors assigned to agents in cycle order. When there are more agents than colors, the palette repeats from the start.",
    minItems: 1,
    validate: colorArrayValidator,
  },
  "graph.mainColor": {
    type: "string",
    defaultValue: "#ff26f8",
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
  "display.maxLoadedEvents": {
    type: "number", defaultValue: 2000, min: 50, max: 50000,
    tooltip: "Maximum events held in memory while scrolling. When this limit is exceeded, the oldest events are trimmed from the buffer to free memory. Higher values let you scroll further without reloading, but use more browser memory.",
  },
  "display.jumpStepSize": {
    type: "number", defaultValue: 50, min: 10, max: 2000,
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

  if (def.validate) return def.validate(value);

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
