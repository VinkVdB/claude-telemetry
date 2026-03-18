// scripts/seed.ts
// Reads real ~/.claude/projects data and processes it into the local SQLite DB
// Usage: CT_DATA_DIR=~/.claude bun scripts/seed.ts

import { Database } from "bun:sqlite";
import { applySchema } from "../src/server/db/schema";
import { processJsonlLine } from "../src/server/ingestion/processor";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const dataDir = process.env.CT_DATA_DIR ?? `${process.env.HOME}/.claude`;
const dbPath = process.env.CT_DB_PATH ?? "./telemetry.db";
const projectsDir = join(dataDir, "projects");

console.log(`Seeding from ${projectsDir} into ${dbPath}`);

const db = new Database(dbPath, { create: true });
applySchema(db);

let totalEvents = 0;

for (const projectSlug of readdirSync(projectsDir)) {
  const projectDir = join(projectsDir, projectSlug);
  if (!statSync(projectDir).isDirectory()) continue;

  const jsonlFiles = readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
  for (const file of jsonlFiles) {
    const filePath = join(projectDir, file);
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    for (const line of lines) {
      const id = processJsonlLine(db, line, projectSlug);
      if (id) totalEvents++;
    }
  }

  // Process subagent files
  const subagentsDir = join(projectDir, "subagents");
  try {
    const subFiles = readdirSync(subagentsDir).filter((f) => f.endsWith(".jsonl"));
    for (const file of subFiles) {
      const content = readFileSync(join(subagentsDir, file), "utf-8");
      for (const line of content.split("\n").filter((l) => l.trim())) {
        const id = processJsonlLine(db, line, projectSlug);
        if (id) totalEvents++;
      }
    }
  } catch {}
}

console.log(`Seeded ${totalEvents} events`);
db.close();
