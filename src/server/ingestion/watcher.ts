// src/server/ingestion/watcher.ts
import chokidar, { type FSWatcher } from "chokidar";
import { statSync } from "fs";
import { basename, dirname, relative } from "path";
import type { Database } from "bun:sqlite";
import { processJsonlLine } from "./processor";
import { getCursor, setCursor, upsertAgent, getSession } from "../db/queries";
import { broadcast } from "../sse/broadcaster";

let watcher: FSWatcher | null = null;

// In-memory cache: agentId → chain_id.
// Lazy-loaded from DB on cache miss, so restarts and session switches are handled without file reads.
// Cleared every 24h to prevent unbounded growth.
const agentChainCache = new Map<string, string>();
setInterval(() => agentChainCache.clear(), 24 * 60 * 60 * 1000).unref();

function getCachedChainId(db: Database, agentId: string): string | undefined {
  const hit = agentChainCache.get(agentId);
  if (hit) return hit;
  // Lazy-load from DB on cache miss (covers restarts and switching between older sessions)
  const row = db.query("SELECT chain_id FROM agents WHERE id = ?").get(agentId) as { chain_id: string | null } | null;
  if (row?.chain_id) {
    agentChainCache.set(agentId, row.chain_id);
    return row.chain_id;
  }
}

function setCachedChainId(agentId: string, chainId: string): void {
  agentChainCache.set(agentId, chainId);
}

interface WatcherConfig {
  projectsDir: string;
  watchMode: "auto" | "native" | "poll";
  pollInterval: number;
  stabilityThreshold?: number;
  writePollInterval?: number;
}

export async function startWatcher(db: Database, config: WatcherConfig): Promise<void> {
  const usePolling = config.watchMode === "poll" ||
    (config.watchMode === "auto" && shouldUsePoll());

  // Collect files found during initial scan (before ready)
  const initialFiles: string[] = [];
  let isReady = false;

  // Chokidar v5 does not support glob patterns — watch the directory directly
  // and filter to .jsonl files via ignored callback
  watcher = chokidar.watch(config.projectsDir, {
    persistent: true,
    usePolling,
    interval: usePolling ? config.pollInterval : undefined,
    ignoreInitial: false,
    // Only watch .jsonl files (ignore non-jsonl files, allow directories)
    ignored: (filePath: string, stats?: { isFile?: () => boolean }) => {
      if (stats && typeof stats.isFile === "function" && stats.isFile()) {
        return !filePath.endsWith(".jsonl");
      }
      return false;
    },
    awaitWriteFinish: { stabilityThreshold: config.stabilityThreshold ?? 200, pollInterval: config.writePollInterval ?? 100 },
  });

  watcher.on("add", (filePath) => {
    if (!filePath.endsWith(".jsonl")) return;
    if (!isReady) {
      // Collect files found during initial scan; process after ready
      initialFiles.push(filePath);
    } else {
      void ingestFile(db, filePath, config.projectsDir);
    }
  });

  watcher.on("change", (filePath) => {
    if (!filePath.endsWith(".jsonl")) return;
    void ingestFile(db, filePath, config.projectsDir);
  });

  // Wait for initial scan, then process all initially discovered files
  await new Promise<void>((resolve) => {
    watcher!.on("ready", async () => {
      isReady = true;
      for (const filePath of initialFiles) {
        await ingestFile(db, filePath, config.projectsDir);
      }
      // One-time backfill: set chain_id for agents ingested before chain_id support was added
      await backfillChainIds(db, config.projectsDir);
      resolve();
    });
  });
}

/** Backfill chain_id for agents that were ingested before chain_id support was added.
 *  Reads the first-line UUID from each agent's subagent JSONL file and updates both
 *  agents.chain_id and events.chain_id. Runs once on startup; skips agents already set. */
async function backfillChainIds(db: Database, projectsDir: string): Promise<void> {
  const agentsWithoutChain = db.query(
    "SELECT a.id, a.session_id, s.project_id FROM agents a JOIN sessions s ON s.id = a.session_id WHERE a.chain_id IS NULL"
  ).all() as { id: string; session_id: string; project_id: string }[];

  if (agentsWithoutChain.length === 0) return;

  let updated = 0;
  for (const agent of agentsWithoutChain) {
    const filePath = `${projectsDir}/${agent.project_id}/${agent.session_id}/subagents/agent-${agent.id}.jsonl`;
    try {
      const firstLine = (await Bun.file(filePath).text()).split("\n")[0];
      if (!firstLine) continue;
      const firstRecord = JSON.parse(firstLine);
      if (!firstRecord?.uuid) continue;

      const chainId: string = firstRecord.uuid;
      db.run("UPDATE agents SET chain_id = ? WHERE id = ? AND chain_id IS NULL", [chainId, agent.id]);
      db.run("UPDATE events SET chain_id = ? WHERE agent_id = ? AND chain_id IS NULL", [chainId, agent.id]);
      setCachedChainId(agent.id, chainId);
      updated++;
    } catch { /* file not found or unreadable — skip */ }
  }

  if (updated > 0) {
    console.log(`[watcher] backfilled chain_id for ${updated} agent(s)`);
  }
}

export async function stopWatcher(): Promise<void> {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
}

async function ingestFile(db: Database, filePath: string, projectsDir: string): Promise<void> {
  try {
    const stat = statSync(filePath);
    const cursor = getCursor(db, filePath);
    const isNewFile = !cursor; // true when file has never been ingested before
    const offset = cursor?.byteOffset ?? 0;

    if (stat.size <= offset) return; // No new data

    // Read only new bytes using Bun's byte-accurate slice
    const bunFile = Bun.file(filePath);
    const newContent = await bunFile.slice(offset).text();
    const lines = newContent.split("\n").filter((l) => l.trim());

    if (lines.length === 0) return;

    // Derive project slug from path
    const relPath = relative(projectsDir, filePath);
    const projectSlug = relPath.split("/")[0] ?? basename(dirname(filePath));

    // For subagent files, resolve chain_id from cache/DB or extract from lines[0] for new files.
    let chainId: string | undefined;
    if (filePath.includes("/subagents/")) {
      const fileName = basename(filePath, ".jsonl");
      const agentId = fileName.startsWith("agent-") ? fileName.slice(6) : fileName;
      if (agentId) {
        chainId = getCachedChainId(db, agentId);
        if (!chainId && offset === 0) {
          // New file — first line is already in memory, no extra read needed
          try {
            const firstRecord = JSON.parse(lines[0]);
            if (firstRecord?.uuid) {
              chainId = firstRecord.uuid;
              setCachedChainId(agentId, chainId);
            }
          } catch { /* malformed first line — chainId stays undefined */ }
        }
      }
    }

    let processedCount = 0;
    let firstSessionId: string | null = null;
    for (const line of lines) {
      const result = processJsonlLine(db, line, projectSlug, chainId);
      if (result) {
        broadcast("event", result);
        if (!firstSessionId) firstSessionId = result.sessionId;
        processedCount++;
      }
    }

    // Update cursor
    setCursor(db, filePath, stat.size, (cursor?.lineCount ?? 0) + processedCount);

    // Broadcast session_new for newly discovered non-subagent session files
    if (isNewFile && !filePath.includes("/subagents/") && processedCount > 0 && firstSessionId) {
      const sess = getSession(db, firstSessionId) as any;
      broadcast("session_new", {
        sessionId: firstSessionId,
        slug: sess?.slug ?? null,
        projectId: sess?.project_id ?? null,
      });
    }

    // Enrich agent from sibling .meta.json for subagent files
    if (filePath.includes("/subagents/") && filePath.endsWith(".jsonl")) {
      const metaPath = filePath.replace(".jsonl", ".meta.json");
      try {
        const metaContent = await Bun.file(metaPath).text();
        const meta = JSON.parse(metaContent);
        // Extract agentId from filename: "agent-{id}.jsonl" -> "{id}"
        const fileName = basename(filePath, ".jsonl");
        const agentId = fileName.startsWith("agent-") ? fileName.slice(6) : fileName;
        // Derive parent session ID from path structure:
        // {projectsDir}/{projectSlug}/{sessionId}/subagents/agent-{id}.jsonl
        const parts = filePath.replace(projectsDir + "/", "").split("/");
        // parts[0] = projectSlug, parts[1] = sessionId, parts[2] = "subagents", parts[3] = filename
        const parentSessionId = parts[1];
        if (agentId && parentSessionId) {
          // chainId was already resolved above (from cache/DB or lines[0])
          upsertAgent(db, {
            id: agentId,
            sessionId: parentSessionId,
            agentType: meta.agentType,
            startedAt: undefined,
            description: meta.description,
            chainId,
          });
        }
      } catch { /* no meta file or invalid JSON — silently skip */ }
    }
  } catch (err) {
    console.error(`[watcher] Error processing ${filePath}:`, err);
  }
}

function shouldUsePoll(): boolean {
  // Docker Desktop on macOS/Windows often needs polling for bind mounts
  // WSL2 cross-filesystem events are unreliable
  const platform = process.platform;
  const isDocker = process.env.CT_DATA_DIR === "/data"; // Our Docker convention
  if (isDocker && platform === "linux") {
    // Inside Docker container — polling is safer for bind mounts
    return true;
  }
  return false;
}
