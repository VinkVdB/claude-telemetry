import type { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { listSessions, getSession, getSessionCostBreakdown, listAgentSummaries } from "../db/queries";
import { getModelPricing } from "../ingestion/pricing";

interface CostRow {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  otel_cost_usd: number | null;
  otel_event_count: number;
  event_count: number;
  [key: string]: unknown;
}

function applyOtelCost(row: CostRow) {
  const isOtelComplete = row.otel_event_count > 0 && row.otel_event_count === row.event_count;

  let totalCost: number;
  let inputCost: number, outputCost: number, cacheReadCost: number, cacheCreationCost: number;

  if (isOtelComplete && row.otel_cost_usd != null) {
    totalCost = row.otel_cost_usd;
    const totalTokens = (row.input_tokens + row.output_tokens + row.cache_read_tokens + row.cache_creation_tokens) || 1;
    inputCost = totalCost * (row.input_tokens / totalTokens);
    outputCost = totalCost * (row.output_tokens / totalTokens);
    cacheReadCost = totalCost * (row.cache_read_tokens / totalTokens);
    cacheCreationCost = totalCost - inputCost - outputCost - cacheReadCost;
  } else {
    const p = getModelPricing(row.model);
    inputCost = p ? (row.input_tokens / 1e6) * p.inputPerMToken : 0;
    outputCost = p ? (row.output_tokens / 1e6) * p.outputPerMToken : 0;
    cacheReadCost = p ? (row.cache_read_tokens / 1e6) * p.cacheReadPerMToken : 0;
    cacheCreationCost = p ? (row.cache_creation_tokens / 1e6) * p.cacheWritePerMToken : 0;
    totalCost = inputCost + outputCost + cacheReadCost + cacheCreationCost;
  }

  return {
    ...row,
    cost_usd: totalCost,
    input_cost: inputCost,
    output_cost: outputCost,
    cache_read_cost: cacheReadCost,
    cache_creation_cost: cacheCreationCost,
  };
}

export { applyOtelCost };

export function createSessionRoutes(app: Hono, db: Database): void {
  app.get("/api/sessions", (c) => {
    const projectId = c.req.query("projectId");
    if (!projectId) return c.json({ error: "projectId required" }, 400);
    return c.json(listSessions(db, projectId));
  });

  app.get("/api/sessions/:id", (c) => {
    const session = getSession(db, c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(session);
  });

  app.get("/api/sessions/:id/costs", (c) => {
    const id = c.req.param("id");
    const rows = getSessionCostBreakdown(db, id) as CostRow[];
    return c.json(rows.map(applyOtelCost));
  });

  app.get("/api/sessions/:id/agent-summaries", (c) => {
    const id = c.req.param("id");
    return c.json(listAgentSummaries(db, id));
  });
}
