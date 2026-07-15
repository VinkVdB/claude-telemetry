// src/server/ingestion/processor.ts
import type { Database } from "bun:sqlite";
import { parseJsonlLine, extractEventData } from "./parser";
import { calculateCost, warnIfUnpriced } from "./pricing";
import { upsertProject, upsertSession, insertEvent, updateSessionAggregates, upsertAgent, updateSessionTitle } from "../db/queries";

export function processJsonlLine(db: Database, rawLine: string, projectSlug: string, chainId?: string): { eventId: string; sessionId: string; type: string } | null {
  const parsed = parseJsonlLine(rawLine);
  if (!parsed) return null;
  // Skip events without a uuid — they can't be deduplicated and corrupt the primary key
  if (!parsed.uuid) return null;
  if (!parsed.sessionId) return null;

  const event = extractEventData(parsed);

  // Surface models we can't price so a silent $0 never slips through (warns once per model).
  warnIfUnpriced(event.model);

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

  // Handle custom-title events: store Claude's auto-generated title unless user renamed
  if (parsed.type === "custom-title" && parsed.customTitle && event.sessionId) {
    updateSessionTitle(db, event.sessionId, parsed.customTitle);
    return null;
  }

  // Deduplicate by (message_id, tool_use_id): Claude Code writes one JSONL line per tool_use block
  // when parallel tool calls are made. All share the same message_id but have distinct tool_use_ids.
  // Deduplication key: (message_id, tool_use_id). Within each key we keep the highest-token entry,
  // preferring finals (stop_reason set) over streaming partials (stop_reason null).
  //
  // "Upgrade" path: early streaming partials have no tool_use yet (tool_use_id=null). When the same
  // message's tool_use event arrives, we UPDATE that early-partial row in-place rather than inserting
  // a new row, so single-tool-call messages still produce exactly one DB event.
  if (event.messageId) {
    const toolUseId = event.toolUseId ?? null;
    const newTotal = (event.inputTokens ?? 0) + (event.outputTokens ?? 0) +
                     (event.cacheReadTokens ?? 0) + (event.cacheCreationTokens ?? 0);

    // Step 1: exact match by (message_id, tool_use_id)
    const existing = db.query(
      `SELECT id, stop_reason,
              COALESCE(input_tokens,0)+COALESCE(output_tokens,0)+COALESCE(cache_read_tokens,0)+COALESCE(cache_creation_tokens,0) as total
       FROM events WHERE message_id = ? AND COALESCE(tool_use_id,'') = COALESCE(?,'')`
    ).get(event.messageId, toolUseId ?? '') as { id: string; total: number; stop_reason: string | null } | null;

    if (existing) {
      // A streaming partial has stop_reason=null. Finals (stop_reason set) always win over partials
      // even when token counts are equal — prevents a partial overwriting a final that carries tool content.
      const existingIsFinal = existing.stop_reason != null;
      const newIsFinal = event.stopReason != null;
      const existingWins = newTotal < existing.total ||
                           (newTotal === existing.total && (existingIsFinal || !newIsFinal));

      if (existingWins) {
        // Existing wins — still fill in tool_name/stop_reason if they are missing
        if (event.toolName || event.stopReason) {
          db.run(
            `UPDATE events SET
               tool_name   = COALESCE(tool_name,   ?),
               stop_reason = COALESCE(stop_reason, ?)
             WHERE message_id = ? AND COALESCE(tool_use_id,'') = COALESCE(?,?)`,
            [event.toolName ?? null, event.stopReason ?? null, event.messageId, toolUseId ?? '', toolUseId ?? '']
          );
        }
        return null;
      }

      // New event wins — UPDATE the existing row in-place (preserving original UUID/rowid)
      const newCost = event.model && newTotal > 0 ? calculateCost(event.model, {
        inputTokens: event.inputTokens ?? 0,
        outputTokens: event.outputTokens ?? 0,
        cacheReadTokens: event.cacheReadTokens ?? 0,
        cacheCreationTokens: event.cacheCreationTokens ?? 0,
      }) : null;
      db.run(
        `UPDATE events SET
           input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_creation_tokens = ?,
           model        = COALESCE(?, model),
           content      = COALESCE(?, content),
           raw          = COALESCE(?, raw),
           cost_usd     = COALESCE(?, cost_usd),
           tool_name    = COALESCE(tool_name, ?),
           stop_reason  = COALESCE(stop_reason, ?)
         WHERE message_id = ? AND COALESCE(tool_use_id,'') = COALESCE(?,?)`,
        [
          event.inputTokens ?? null, event.outputTokens ?? null,
          event.cacheReadTokens ?? null, event.cacheCreationTokens ?? null,
          event.model ?? null, event.content ?? null, rawLine,
          newCost ?? null, event.toolName ?? null, event.stopReason ?? null,
          event.messageId, toolUseId ?? '', toolUseId ?? '',
        ]
      );
      updateSessionAggregates(db, event.sessionId);
      return null;
    }

    // Step 2: upgrade path — if this event has a tool_use_id and there's an early streaming partial
    // (same message_id, tool_use_id IS NULL, stop_reason IS NULL), claim that row rather than
    // inserting a new one. This keeps single-tool-call messages as exactly one DB event.
    if (toolUseId) {
      const earlyPartial = db.query(
        `SELECT id FROM events WHERE message_id = ? AND tool_use_id IS NULL LIMIT 1`
      ).get(event.messageId) as { id: string } | null;

      if (earlyPartial) {
        const newCost = event.model && newTotal > 0 ? calculateCost(event.model, {
          inputTokens: event.inputTokens ?? 0,
          outputTokens: event.outputTokens ?? 0,
          cacheReadTokens: event.cacheReadTokens ?? 0,
          cacheCreationTokens: event.cacheCreationTokens ?? 0,
        }) : null;
        db.run(
          `UPDATE events SET
             tool_use_id  = ?,
             input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_creation_tokens = ?,
             model        = COALESCE(?, model),
             content      = COALESCE(?, content),
             raw          = COALESCE(?, raw),
             cost_usd     = COALESCE(?, cost_usd),
             tool_name    = COALESCE(tool_name, ?),
             stop_reason  = COALESCE(stop_reason, ?)
           WHERE id = ?`,
          [
            toolUseId,
            event.inputTokens ?? null, event.outputTokens ?? null,
            event.cacheReadTokens ?? null, event.cacheCreationTokens ?? null,
            event.model ?? null, event.content ?? null, rawLine,
            newCost ?? null, event.toolName ?? null, event.stopReason ?? null,
            earlyPartial.id,
          ]
        );
        updateSessionAggregates(db, event.sessionId);
        return null;
      }
    }
  }

  // Insert event
  insertEvent(db, {
    id: event.id,
    messageId: event.messageId,
    toolUseId: event.toolUseId,
    sessionId: event.sessionId,
    parentId: event.parentId,
    type: event.type,
    timestamp: event.timestamp,
    model: event.model,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    cacheReadTokens: event.cacheReadTokens,
    cacheCreationTokens: event.cacheCreationTokens,
    costUsd: event.model && event.inputTokens != null ? calculateCost(event.model, {
      inputTokens: event.inputTokens ?? 0,
      outputTokens: event.outputTokens ?? 0,
      cacheReadTokens: event.cacheReadTokens ?? 0,
      cacheCreationTokens: event.cacheCreationTokens ?? 0,
    }) : undefined,
    toolName: event.toolName,
    stopReason: event.stopReason,
    content: event.content,
    raw: rawLine,
    agentId: event.agentId,
    chainId: chainId ?? undefined,
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
      chainId,
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
