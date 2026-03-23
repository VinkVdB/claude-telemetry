// src/client/components/CostBreakdownPanel.tsx
import { formatTokens, formatCost } from "../lib/utils";
import { useSettings } from "../contexts/SettingsContext";
import type { CostBreakdown } from "../lib/types";
import type { ModelPricing } from "@shared/pricing";

function tokenCost(tokens: number, ratePerMToken: number): number {
  return (tokens / 1_000_000) * ratePerMToken;
}

export interface CostBreakdownPanelProps {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheRead: number;
  totalCacheCreation: number;
  totalCost: number;
  perModel?: CostBreakdown[];
}

export function CostBreakdownPanel({
  totalInputTokens,
  totalOutputTokens,
  totalCacheRead,
  totalCacheCreation,
  totalCost,
  perModel,
}: CostBreakdownPanelProps) {
  const { settings } = useSettings();
  const formatOpts = {
    kThreshold: settings["display.tokenKThreshold"] as number,
    mThreshold: settings["display.tokenMThreshold"] as number,
    costPrecisionThreshold: settings["display.costPrecisionThreshold"] as number,
  };
  const pricingModels = settings["pricing.models"] ?? {};
  const getSettingsPricing = (model: string): ModelPricing | null => {
    if (pricingModels[model]) return pricingModels[model];
    const base = model.replace(/-\d{8}$/, "");
    return pricingModels[base] ?? null;
  };
  const totalTokens = totalInputTokens + totalOutputTokens + totalCacheRead + totalCacheCreation;

  return (
    <div className="border border-border rounded-xl bg-white p-4 mb-6">
      {/* Top row: total cost + total tokens */}
      <div className="flex items-baseline gap-8 mb-3">
        <div>
          <span className="text-xs text-muted uppercase tracking-wide">Total Cost</span>
          <p className="text-2xl font-bold text-primary-dark">{formatCost(totalCost, formatOpts)}</p>
        </div>
        <div>
          <span className="text-xs text-muted uppercase tracking-wide">Total Tokens</span>
          <p className="text-2xl font-bold text-primary-dark">{formatTokens(totalTokens, formatOpts)}</p>
        </div>
      </div>

      {/* Token breakdown */}
      {(() => {
        const inputCost = perModel?.reduce((sum, m) => {
          const p = getSettingsPricing(m.model);
          return sum + (p ? tokenCost(m.input_tokens, p.inputPerMToken) : 0);
        }, 0) ?? 0;
        const outputCost = perModel?.reduce((sum, m) => {
          const p = getSettingsPricing(m.model);
          return sum + (p ? tokenCost(m.output_tokens, p.outputPerMToken) : 0);
        }, 0) ?? 0;
        const cacheReadCost = perModel?.reduce((sum, m) => {
          const p = getSettingsPricing(m.model);
          return sum + (p ? tokenCost(m.cache_read_tokens, p.cacheReadPerMToken) : 0);
        }, 0) ?? 0;
        const cacheWriteCost = perModel?.reduce((sum, m) => {
          const p = getSettingsPricing(m.model);
          return sum + (p ? tokenCost(m.cache_creation_tokens, p.cacheWritePerMToken) : 0);
        }, 0) ?? 0;
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-2">
            <TokenStat label="Input" tokens={totalInputTokens} cost={inputCost} formatOpts={formatOpts} />
            <TokenStat label="Output" tokens={totalOutputTokens} cost={outputCost} formatOpts={formatOpts} />
            <TokenStat label="Cache read" tokens={totalCacheRead} cost={cacheReadCost} formatOpts={formatOpts} />
            <TokenStat label="Cache write" tokens={totalCacheCreation} cost={cacheWriteCost} formatOpts={formatOpts} />
          </div>
        );
      })()}

      {/* Per-model breakdown */}
      {perModel && perModel.length > 0 && (
        <details className="mt-3 border-t border-border pt-3">
          <summary className="text-sm font-medium text-primary cursor-pointer select-none hover:text-primary-dark transition-colors">
            Per-model breakdown ({perModel.length} model{perModel.length > 1 ? "s" : ""})
          </summary>
          <div className="mt-3 space-y-3">
            {perModel.map((m) => (
              <ModelCard key={m.model} data={m} getPricing={getSettingsPricing} formatOpts={formatOpts} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function TokenStat({ label, tokens, cost, formatOpts }: { label: string; tokens: number; cost?: number; formatOpts?: import("../lib/utils").FormatOptions }) {
  return (
    <div className="bg-surface rounded-lg px-3 py-2">
      <span className="text-xs text-muted">{label}</span>
      <p className="font-semibold text-primary-dark">
        {formatTokens(tokens, formatOpts)}
        {cost != null && cost > 0 && <span className="text-muted text-xs ml-1">({formatCost(cost, formatOpts)})</span>}
      </p>
    </div>
  );
}

function ModelCard({ data, getPricing, formatOpts }: { data: CostBreakdown; getPricing: (model: string) => ModelPricing | null; formatOpts?: import("../lib/utils").FormatOptions }) {
  const pricing = getPricing(data.model);
  const modelLabel = data.model
    .replace("claude-", "")
    .replace(/-\d{8}$/, "")
    .split("-")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

  return (
    <div className="bg-surface rounded-lg p-3">
      <div className="flex items-baseline justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-primary-dark text-sm">{modelLabel}</span>
          {data.otel_event_count != null && data.otel_event_count > 0 && data.otel_event_count === data.event_count && (
            <span className="text-[10px] font-semibold uppercase tracking-wide bg-accent/20 text-primary-dark px-1.5 py-0.5 rounded">OTEL</span>
          )}
        </div>
        <span className="text-sm font-semibold text-primary-dark">{formatCost(data.cost_usd, formatOpts)}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <TokenLine label="Input" tokens={data.input_tokens} pricing={pricing} rate="inputPerMToken" formatOpts={formatOpts} />
        <TokenLine label="Output" tokens={data.output_tokens} pricing={pricing} rate="outputPerMToken" formatOpts={formatOpts} />
        <TokenLine label="Cache read" tokens={data.cache_read_tokens} pricing={pricing} rate="cacheReadPerMToken" formatOpts={formatOpts} />
        <TokenLine label="Cache write" tokens={data.cache_creation_tokens} pricing={pricing} rate="cacheWritePerMToken" formatOpts={formatOpts} />
      </div>
      <div className="text-xs text-muted mt-1">{data.event_count} event{data.event_count !== 1 ? "s" : ""}</div>
    </div>
  );
}

function TokenLine({
  label,
  tokens,
  pricing,
  rate,
  formatOpts,
}: {
  label: string;
  tokens: number;
  pricing: ModelPricing | null;
  rate: keyof ModelPricing;
  formatOpts?: import("../lib/utils").FormatOptions;
}) {
  const cost = pricing ? tokenCost(tokens, pricing[rate]) : null;
  return (
    <div>
      <span className="text-muted">{label}</span>
      <p className="font-medium text-primary-dark">
        {formatTokens(tokens, formatOpts)}
        {cost != null && <span className="text-muted ml-1">({formatCost(cost, formatOpts)})</span>}
      </p>
    </div>
  );
}
