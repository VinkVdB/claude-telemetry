// src/server/db/settings.ts
import type { Database } from "bun:sqlite";

export function getAllSettings(db: Database): Record<string, any> {
  const rows = db.query("SELECT key, value FROM settings WHERE key NOT LIKE 'migration_%'").all() as { key: string; value: string }[];
  const result: Record<string, any> = {};
  for (const row of rows) {
    try { result[row.key] = JSON.parse(row.value); } catch { result[row.key] = row.value; }
  }
  return result;
}

export function getSetting(db: Database, key: string): any {
  const row = db.query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export function upsertSettings(db: Database, updates: Record<string, any>): void {
  const stmt = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  );
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(updates)) {
      stmt.run(key, JSON.stringify(value));
    }
  });
  tx();
}

export function deleteSettings(db: Database, keys: string[]): void {
  const placeholders = keys.map(() => "?").join(", ");
  db.run(`DELETE FROM settings WHERE key IN (${placeholders})`, keys);
}

export function deleteAllSettings(db: Database): void {
  db.run("DELETE FROM settings");
}
