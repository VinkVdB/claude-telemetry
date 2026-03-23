// src/server/ingestion/processor.ts
import type { Database } from "bun:sqlite";
import { parseJsonlLine, extractEventData } from "./parser";
import { calculateCost } from "./pricing";
import { upsertProject, upsertSession, insertEvent, updateSessionAggregates, upsertAgent } from "../db/queries";

export function processJsonlLine(db: Database, rawLine: string, projectSlug: string): { eventId: string; sessionId: string; type: string } | null {
  const parsed = parseJsonlLine(rawLine);
  if (!parsed) return null;
  // Skip events without a uuid — they can't be deduplicated and corrupt the primary key
  if (!parsed.uuid) return null;
  if (!parsed.sessionId) return null;

  const event = extractEventData(parsed);

  // Normalize git worktree cwd to the parent project path so worktree sessions
  // are grouped under the same project as their parent repo.
  // e.g. /Users/foo/project/.worktrees/my-branch → /Users/foo/project
  const { effectiveSlug, effectivePath } = resolveProject(parsed.cwd, projectSlug);
  const projectName = deriveProjectName(effectivePath, effectiveSlug);

  // Upsert project
  upsertProject(db, effectiveSlug, projectName, effectivePath);

  // Upsert session
  upsertSession(db, event.sessionId, effectiveSlug, {
    gitBranch: event.sessionMeta?.gitBranch,
    slug: event.sessionMeta?.slug,
    startedAt: event.timestamp,
  });

  // Deduplicate by message.id: one API response can produce multiple JSONL lines with different
  // UUIDs but identical token usage (e.g. text + tool_use blocks). Keep only the entry with the
  // highest total token count (the final non-streaming entry).
  if (event.messageId) {
    const existing = db.query(
      `SELECT id, COALESCE(input_tokens,0)+COALESCE(output_tokens,0)+COALESCE(cache_read_tokens,0)+COALESCE(cache_creation_tokens,0) as total
       FROM events WHERE message_id = ?`
    ).get(event.messageId) as { id: string; total: number } | null;
    if (existing) {
      const newTotal = (event.inputTokens ?? 0) + (event.outputTokens ?? 0) +
                       (event.cacheReadTokens ?? 0) + (event.cacheCreationTokens ?? 0);
      if (newTotal <= existing.total) return null; // existing is already the best version
      db.run("DELETE FROM events WHERE message_id = ?", [event.messageId]);
    }
  }

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
    messageId: event.messageId,
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
    agentId: event.agentId,
  });

  // Update session aggregates
  updateSessionAggregates(db, event.sessionId);

  // Register sidechain agents so AgentTimeline/Graph can show them
  if (parsed.isSidechain && parsed.agentId) {
    upsertAgent(db, {
      id: parsed.agentId,           // agentId from JSONL (e.g. "a37eeb8c230f9c26f")
      sessionId: event.sessionId,   // event.sessionId IS the parent session ID for subagents
      agentType: (parsed as any).agentType ?? undefined,
      startedAt: event.timestamp,
    });
  }

  return { eventId: event.id, sessionId: event.sessionId, type: event.type };
}

/** Detect git worktrees and return the canonical project slug + path. */
function resolveProject(cwd: string | undefined, fallbackSlug: string): { effectiveSlug: string; effectivePath: string } {
  if (cwd) {
    // Match /.worktrees/<branch> or /worktrees/<branch> (with optional trailing path)
    const match = cwd.match(/^(.+?)\/(\.worktrees|worktrees)\/[^/]+(\/.*)?$/);
    if (match) {
      const parentPath = match[1];
      // Convert absolute path to slug: replace every "/" with "-" (leading "/" becomes leading "-")
      const parentSlug = parentPath.replace(/\//g, "-");
      return { effectiveSlug: parentSlug, effectivePath: parentPath };
    }
  }
  return { effectiveSlug: fallbackSlug, effectivePath: cwd ?? fallbackSlug };
}

function deriveProjectName(cwd: string | undefined, projectSlug: string): string {
  if (cwd) {
    const parts = cwd.split("/").filter(Boolean);
    return parts[parts.length - 1] || projectSlug;
  }
  const parts = projectSlug.split("-").filter(Boolean);
  return parts[parts.length - 1] || projectSlug;
}
