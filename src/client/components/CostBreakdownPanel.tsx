// src/client/components/CostBreakdownPanel.tsx
import { formatTokens, formatCost } from "../lib/utils";
import type { CostBreakdown } from "../lib/types";
import { getModelPricing, type ModelPricing } from "@shared/pricing";

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
  const totalTokens = totalInputTokens + totalOutputTokens + totalCacheRead + totalCacheCreation;

  return (
    <div className="border border-border rounded-xl bg-white p-4 mb-6">
      {/* Top row: total cost + total tokens */}
      <div className="flex items-baseline gap-8 mb-3">
        <div>
          <span className="text-xs text-muted uppercase tracking-wide">Total Cost</span>
          <p className="text-2xl font-bold text-primary-dark">{formatCost(totalCost)}</p>
        </div>
        <div>
          <span className="text-xs text-muted uppercase tracking-wide">Total Tokens</span>
          <p className="text-2xl font-bold text-primary-dark">{formatTokens(totalTokens)}</p>
        </div>
      </div>

      {/* Token breakdown */}
      {(() => {
        const inputCost = perModel?.reduce((sum, m) => {
          const p = getModelPricing(m.model);
          return sum + (p ? tokenCost(m.input_tokens, p.inputPerMToken) : 0);
        }, 0) ?? 0;
        const outputCost = perModel?.reduce((sum, m) => {
          const p = getModelPricing(m.model);
          return sum + (p ? tokenCost(m.output_tokens, p.outputPerMToken) : 0);
        }, 0) ?? 0;
        const cacheReadCost = perModel?.reduce((sum, m) => {
          const p = getModelPricing(m.model);
          return sum + (p ? tokenCost(m.cache_read_tokens, p.cacheReadPerMToken) : 0);
        }, 0) ?? 0;
        const cacheWriteCost = perModel?.reduce((sum, m) => {
          const p = getModelPricing(m.model);
          return sum + (p ? tokenCost(m.cache_creation_tokens, p.cacheWritePerMToken) : 0);
        }, 0) ?? 0;
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-2">
            <TokenStat label="Input" tokens={totalInputTokens} cost={inputCost} />
            <TokenStat label="Output" tokens={totalOutputTokens} cost={outputCost} />
            <TokenStat label="Cache read" tokens={totalCacheRead} cost={cacheReadCost} />
            <TokenStat label="Cache write" tokens={totalCacheCreation} cost={cacheWriteCost} />
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
              <ModelCard key={m.model} data={m} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function TokenStat({ label, tokens, cost }: { label: string; tokens: number; cost?: number }) {
  return (
    <div className="bg-surface rounded-lg px-3 py-2">
      <span className="text-xs text-muted">{label}</span>
      <p className="font-semibold text-primary-dark">
        {formatTokens(tokens)}
        {cost != null && cost > 0 && <span className="text-muted text-xs ml-1">({formatCost(cost)})</span>}
      </p>
    </div>
  );
}

function ModelCard({ data }: { data: CostBreakdown }) {
  const pricing = getModelPricing(data.model);
  const modelLabel = data.model
    .replace("claude-", "")
    .replace(/-\d{8}$/, "")
    .split("-")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

  return (
    <div className="bg-surface rounded-lg p-3">
      <div className="flex items-baseline justify-between mb-2">
        <span className="font-medium text-primary-dark text-sm">{modelLabel}</span>
        <span className="text-sm font-semibold text-primary-dark">{formatCost(data.cost_usd)}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <TokenLine label="Input" tokens={data.input_tokens} pricing={pricing} rate="inputPerMToken" />
        <TokenLine label="Output" tokens={data.output_tokens} pricing={pricing} rate="outputPerMToken" />
        <TokenLine label="Cache read" tokens={data.cache_read_tokens} pricing={pricing} rate="cacheReadPerMToken" />
        <TokenLine label="Cache write" tokens={data.cache_creation_tokens} pricing={pricing} rate="cacheWritePerMToken" />
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
}: {
  label: string;
  tokens: number;
  pricing: ModelPricing | null;
  rate: keyof ModelPricing;
}) {
  const cost = pricing ? tokenCost(tokens, pricing[rate]) : null;
  return (
    <div>
      <span className="text-muted">{label}</span>
      <p className="font-medium text-primary-dark">
        {formatTokens(tokens)}
        {cost != null && <span className="text-muted ml-1">({formatCost(cost)})</span>}
      </p>
    </div>
  );
}
