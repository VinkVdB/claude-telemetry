// src/server/ingestion/watcher.ts
import chokidar, { type FSWatcher } from "chokidar";
import { statSync } from "fs";
import { basename, dirname, relative } from "path";
import type { Database } from "bun:sqlite";
import { processJsonlLine } from "./processor";
import { getCursor, setCursor, upsertAgent, getSession } from "../db/queries";
import { broadcast } from "../sse/broadcaster";

let watcher: FSWatcher | null = null;

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
      resolve();
    });
  });
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

    let processedCount = 0;
    let firstSessionId: string | null = null;
    for (const line of lines) {
      const result = processJsonlLine(db, line, projectSlug);
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
          upsertAgent(db, {
            id: agentId,
            sessionId: parentSessionId,
            agentType: meta.agentType,
            startedAt: undefined,
            description: meta.description,
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
