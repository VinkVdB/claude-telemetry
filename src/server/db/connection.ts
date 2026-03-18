// src/server/db/connection.ts
import { Database } from "bun:sqlite";
import { applySchema } from "./schema";

let db: Database | null = null;

export function getDb(dbPath = "/data/db/telemetry.db"): Database {
  if (!db) {
    db = new Database(dbPath, { create: true });
    applySchema(db);
  }
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}
