// src/server/ingestion/processor.ts
import type { Database } from "bun:sqlite";
import { parseJsonlLine, extractEventData } from "./parser";
import { calculateCost } from "./pricing";
import { upsertProject, upsertSession, insertEvent, updateSessionAggregates } from "../db/queries";

export function processJsonlLine(db: Database, rawLine: string, projectSlug: string): { eventId: string; sessionId: string; type: string } | null {
  const parsed = parseJsonlLine(rawLine);
  if (!parsed) return null;

  const event = extractEventData(parsed);

  // Derive project name from cwd or slug
  const projectName = deriveProjectName(parsed.cwd, projectSlug);
  const projectPath = parsed.cwd ?? projectSlug;

  // Upsert project
  upsertProject(db, projectSlug, projectName, projectPath);

  // Upsert session
  upsertSession(db, event.sessionId, projectSlug, {
    gitBranch: event.sessionMeta?.gitBranch,
    slug: event.sessionMeta?.slug,
    startedAt: event.timestamp,
  });

  // Calculate cost if we have token data
  let costUsd: number | undefined;
  if (event.model && event.inputTokens != null) {
    costUsd = calculateCost(event.model, {
      inputTokens: event.inputTokens ?? 0,
      outputTokens: event.outputTokens ?? 0,
      cacheReadTokens: event.cacheReadTokens ?? 0,
      cacheCreationTokens: event.cacheCreationTokens ?? 0,
    });
  }

  // Insert event
  insertEvent(db, {
    id: event.id,
    sessionId: event.sessionId,
    parentId: event.parentId,
    type: event.type,
    timestamp: event.timestamp,
    model: event.model,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    cacheReadTokens: event.cacheReadTokens,
    cacheCreationTokens: event.cacheCreationTokens,
    costUsd: costUsd,
    toolName: event.toolName,
    stopReason: event.stopReason,
    content: event.content,
    raw: rawLine,
  });

  // Update session aggregates
  updateSessionAggregates(db, event.sessionId);

  return { eventId: event.id, sessionId: event.sessionId, type: event.type };
}

function deriveProjectName(cwd: string | undefined, projectSlug: string): string {
  if (cwd) {
    const parts = cwd.split("/").filter(Boolean);
    return parts[parts.length - 1] || projectSlug;
  }
  const parts = projectSlug.split("-").filter(Boolean);
  return parts[parts.length - 1] || projectSlug;
}
