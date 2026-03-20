# Settings Page Design

In-app settings UI for configurable constants across model pricing, agent graph visuals, server polling, and display formatting.

## Decisions

- **Architecture**: Single `/settings` route with 4 tabbed sections
- **Persistence**: SQLite `settings` table (key-value, JSON-encoded values)
- **Apply mode**: UI settings apply live; server settings require restart
- **Theme**: Brand colors and fonts stay fixed (not configurable)

## Database

```sql
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,       -- JSON-encoded
  updated_at  TEXT DEFAULT (datetime('now'))
);
```

Defaults are not stored in the database. When a key is missing, the application uses the hardcoded default. Only user-overridden values are persisted. A "Reset to Defaults" action deletes the row.

## API

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/api/settings` | — | Returns all settings merged with defaults |
| `PUT` | `/api/settings` | `{ key: value, ... }` | Bulk upsert. Validates each value against its schema. |
| `POST` | `/api/settings/reset` | `{ keys?: string[] }` | Delete specified keys (or all) to restore defaults |

Validation happens server-side. The API returns `400` with `{ error, key, constraint }` on invalid values.

## Settings Registry

Each setting has a key, default value, type, validation constraints, and a tooltip shown on hover.

### Tab 1: Model Pricing

Stored as a single JSON object under key `pricing.models`.

```typescript
{
  "claude-opus-4-6": {
    inputPerMToken: 15,
    outputPerMToken: 75,
    cacheReadPerMToken: 1.5,
    cacheWritePerMToken: 18.75
  },
  "claude-sonnet-4-6": { ... },
  "claude-haiku-4-5": { ... }
}
```

- Users can edit rates for existing models, add new models (free-text model name + 4 rates), or remove models.
- All rate values must be >= 0.
- Model names must be non-empty strings, no duplicates.
- Changes apply to cost calculations for new events immediately (no restart needed). The server re-reads pricing from the DB on each `calculateCost()` call via a cached lookup that invalidates on `PUT /api/settings`. Existing events retain their computed costs.
- **Tooltip (section)**: "USD per 1M tokens. Changes apply to new events only — existing costs are not recalculated."
- **Tooltip (+ Add Model)**: "Add pricing for a model not listed here. Use the exact model ID from Claude API (e.g. claude-opus-4-6). Date suffixes like -20260301 are stripped automatically during lookup."

### Tab 2: Agent Graph

| Key | Default | Type | Min | Max | Tooltip |
|-----|---------|------|-----|-----|---------|
| `graph.agentColors` | `["#00a2e0","#bdd72d","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#ec4899"]` | string[] | 1 item | — | Colors assigned to agents in cycle order. When there are more agents than colors, the palette repeats from the start. Click a swatch to edit, click + to add more. |
| `graph.mainColor` | `"#003864"` | string | — | — | Color for the main session node — the central hub that spawns agents. |
| `graph.continuousSimulation` | `false` | boolean | — | — | Keep the force simulation running so nodes float and react to new agents in real-time. When off, the graph settles once and freezes. |
| `graph.linkDistance` | `150` | number | 50 | 500 | Target distance between connected nodes (px). Higher values spread the graph out; lower values pack it tighter. |
| `graph.chargeStrength` | `-300` | number | -1000 | -10 | Repulsion force between all nodes. More negative = nodes push apart harder, preventing overlap in dense graphs. |
| `graph.collideRadius` | `50` | number | 10 | 200 | Minimum gap between node edges (px). Prevents nodes from overlapping regardless of other forces. |
| `graph.alphaDecay` | `0.05` | number | 0.01 | 0.5 | How fast the simulation cools down. Lower = smoother settling but slower. Only affects initial layout when continuous simulation is off. |
| `graph.linkThicknessMin` | `1` | number | 1 | 10 | Thinnest link width (px), for connections with the fewest events. |
| `graph.linkThicknessMax` | `10` | number | 2 | 30 | Thickest link width (px), for connections with the most events. Must be greater than min. |
| `graph.opacityDecayMinutes` | `5` | number | 1 | 60 | Minutes of inactivity before a link fades to 50% opacity. Higher values keep old connections visible longer. |

**Agent Colors behavior**:
- Rendered as a row of color swatches with a + button to add more.
- Click a swatch to open a color picker (native `<input type="color">`).
- Click X on a swatch to remove it (minimum 1 color required).
- Drag to reorder (optional — can be deferred to v2).
- No upper limit on number of colors.

**Continuous simulation behavior**:
- When enabled: `simulation.alphaMin(0)` and `alphaTarget(0.01)` keep it running. On new agent/event via SSE, reheat with `simulation.alpha(0.3).restart()`.
- When disabled: current behavior — simulate, settle, stop. Force params still control the initial layout.

### Tab 3: Server

All server settings show a warning banner: "Server settings require a restart to take effect."

| Key | Default | Type | Min | Max | Tooltip |
|-----|---------|------|-----|-----|---------|
| `server.pollInterval` | `1000` | number | 100 | 30000 | How often to check for file changes (ms). Lower = faster updates but higher CPU usage. Only used when watch mode is set to polling. |
| `server.stabilityThreshold` | `200` | number | 50 | 5000 | Wait this long after a file stops changing before processing it (ms). Prevents reading partially-written JSONL files. |
| `server.writePollInterval` | `100` | number | 50 | 2000 | How often to check whether a file has finished writing (ms). Used during the stability wait period. |

### Tab 4: Display

| Key | Default | Type | Min | Max | Tooltip |
|-----|---------|------|-----|-----|---------|
| `display.maxLoadedEvents` | `500` | number | 50 | 5000 | Maximum events held in memory while scrolling. When this limit is exceeded, the oldest events are trimmed from the buffer to free memory. Higher values let you scroll further without reloading, but use more browser memory. |
| `display.jumpStepSize` | `50` | number | 10 | 500 | Number of events to skip when clicking the +/- navigation buttons in the event table. |
| `display.costPrecisionThreshold` | `0.01` | number | 0.001 | 1.0 | Costs below this amount show 4 decimal places (e.g. $0.0023); costs at or above show 2 (e.g. $1.50). |
| `display.tokenKThreshold` | `1000` | number | 100 | 10000 | Token counts at or above this display with K suffix (e.g. 1.5K instead of 1500). |
| `display.tokenMThreshold` | `1000000` | number | 100000 | 10000000 | Token counts at or above this display with M suffix (e.g. 2.3M instead of 2300000). Must be greater than K threshold. |
| `display.timeAgoJustNow` | `60` | number | 5 | 300 | Seconds. Events newer than this show "just now" instead of a relative time. |
| `display.timeAgoMinutes` | `60` | number | 10 | 1440 | Minutes. Events older than this switch from "Xm ago" to "Xh ago". |
| `display.timeAgoHours` | `24` | number | 1 | 168 | Hours. Events older than this switch from "Xh ago" to "Xd ago". |
| `display.traceRowHeight` | `32` | number | 16 | 64 | Height of each row in the trace waterfall view (px). Increase for readability, decrease to fit more rows on screen. |
| `display.traceMinSpanWidth` | `4` | number | 1 | 20 | Minimum width for trace spans (px). Ensures very short events are still visible and clickable. |
| `display.traceLabelWidth` | `160` | number | 80 | 300 | Width of the agent name column in trace view (px). Increase if agent names are being truncated. |

## React Architecture

### SettingsContext

```typescript
// src/client/contexts/SettingsContext.tsx
interface SettingsContextValue {
  settings: ResolvedSettings;    // defaults merged with user overrides
  updateSettings: (updates: Record<string, any>) => Promise<void>;
  resetSettings: (keys?: string[]) => Promise<void>;
  isLoading: boolean;
}
```

- Provider wraps the app in `App.tsx`, fetches settings on mount via `GET /api/settings`.
- `updateSettings` calls `PUT /api/settings`, then updates local state on success.
- `resetSettings` calls `POST /api/settings/reset`, then refetches.

### useSettings hook

```typescript
const { settings, updateSettings } = useSettings();
// Components destructure what they need:
const colors = settings.graph.agentColors;
```

### Consuming components

Components currently reading hardcoded constants switch to `useSettings()`:

| Component | Currently reads | Switches to |
|-----------|----------------|-------------|
| `AgentGraph.tsx` | `AGENT_COLORS`, `MAIN_COLOR`, force params | `settings.graph.*` |
| `AgentTimeline.tsx` | `AGENT_COLORS`, `MAIN_COLOR` | `settings.graph.agentColors`, `settings.graph.mainColor` |
| `TraceView.tsx` | `AGENT_COLORS`, `ROW_HEIGHT`, `LABEL_WIDTH`, `MIN_SPAN_WIDTH` | `settings.graph.agentColors`, `settings.display.trace*` |
| `EventTable.tsx` | hardcoded 50 in jump buttons, 200px scroll trigger | `settings.display.jumpStepSize` |
| `useInfiniteEvents.ts` | `MAX_LOADED_EVENTS = 500` | `settings.display.maxLoadedEvents` |
| `utils.ts` | hardcoded thresholds in `formatTokens`, `formatCost`, `timeAgo` | Accept thresholds as params, sourced from settings |
| `CostBreakdownPanel.tsx` | `getModelPricing()` from shared | Uses settings-aware pricing |
| `processor.ts` (server) | `calculateCost()` from shared pricing | Uses cached pricing that auto-invalidates on settings change |
| `watcher.ts` (server) | `config.pollInterval`, chokidar options | Reads from settings DB on startup, falls back to env vars. Env vars override DB values when set. |

### Pricing integration

The shared `pricing.ts` module gets a `loadPricingFromSettings(db)` function called on server startup. It merges DB-stored custom pricing over the hardcoded defaults and caches the result in memory. The `PUT /api/settings` handler invalidates this cache when pricing keys change, so the next `calculateCost()` call re-reads from DB. This means pricing changes apply live to new events without a restart.

**Precedence for server settings**: env vars > DB settings > hardcoded defaults. When `CT_POLL_INTERVAL` is set as an env var, it takes precedence over the DB value. The settings UI shows the effective value and a note when an env var override is active.

The frontend reads pricing via `GET /api/settings` and uses it in `CostBreakdownPanel`.

### Settings page

New files:
- `src/client/pages/SettingsPage.tsx` — main page with tab navigation
- `src/client/components/settings/PricingTab.tsx`
- `src/client/components/settings/GraphTab.tsx`
- `src/client/components/settings/ServerTab.tsx`
- `src/client/components/settings/DisplayTab.tsx`
- `src/server/api/settings.ts` — API route handlers
- `src/server/db/settings.ts` — DB queries for settings table
- `src/shared/settings-defaults.ts` — single source of truth for default values, types, constraints, and tooltips

### Tooltip implementation

Each setting input has an info icon (ℹ) that shows the tooltip on hover. Tooltips use a simple CSS `title` attribute for v1, upgradeable to a custom tooltip component later. The tooltip text comes from the shared defaults registry.

## UI Details

### Save behavior
- A "Save" button at the bottom of each tab. Disabled when no changes.
- "Reset to Defaults" button resets the current tab's settings.
- UI settings apply immediately on save (context updates, components re-render).
- Server settings show the restart warning banner.

### Validation
- Client-side: inputs enforce min/max via HTML attributes + JS validation on blur.
- Server-side: `PUT /api/settings` validates all values against the registry constraints.
- Invalid values show inline red text below the input with the constraint that was violated.

### Navigation
- New "Settings" nav item in the sidebar (`Shell.tsx`), with a gear icon.
- Positioned below "Raw Explorer".

## Files Changed (Existing)

| File | Change |
|------|--------|
| `src/server/db/schema.ts` | Add `settings` table |
| `src/server/index.ts` | Mount settings API routes, load pricing from settings |
| `src/client/components/layout/Shell.tsx` | Add Settings nav item |
| `src/client/router.tsx` | Add `/settings` route |
| `src/client/App.tsx` | Wrap with `SettingsProvider` |
| `src/shared/pricing.ts` | Add `setPricing()` / `loadPricingFromSettings()` |
| `src/client/components/AgentGraph.tsx` | Read from settings context |
| `src/client/components/AgentTimeline.tsx` | Read from settings context |
| `src/client/components/TraceView.tsx` | Read from settings context |
| `src/client/components/EventTable.tsx` | Read jump step from settings |
| `src/client/hooks/useInfiniteEvents.ts` | Read maxLoadedEvents from settings |
| `src/client/lib/utils.ts` | Accept formatting thresholds as params |
| `src/server/ingestion/watcher.ts` | Read poll settings from DB |
| `src/server/ingestion/processor.ts` | Use settings-aware pricing |

## Files Created (New)

| File | Purpose |
|------|---------|
| `src/shared/settings-defaults.ts` | Default values, types, constraints, tooltips |
| `src/client/contexts/SettingsContext.tsx` | React context + provider |
| `src/client/pages/SettingsPage.tsx` | Settings page with tab navigation |
| `src/client/components/settings/PricingTab.tsx` | Model pricing editor |
| `src/client/components/settings/GraphTab.tsx` | Agent graph settings |
| `src/client/components/settings/ServerTab.tsx` | Server polling settings |
| `src/client/components/settings/DisplayTab.tsx` | Display formatting settings |
| `src/server/api/settings.ts` | Settings API endpoints |
| `src/server/db/settings.ts` | Settings DB queries |
