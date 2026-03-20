// test/server/settings-db.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../../src/server/db/schema";
import {
  getAllSettings,
  getSetting,
  upsertSettings,
  deleteSettings,
  deleteAllSettings,
} from "../../src/server/db/settings";

describe("settings DB", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
  });

  test("getAllSettings returns empty object when no overrides", () => {
    expect(getAllSettings(db)).toEqual({});
  });

  test("upsertSettings writes and getSetting reads", () => {
    upsertSettings(db, { "graph.linkDistance": 200 });
    expect(getSetting(db, "graph.linkDistance")).toBe(200);
  });

  test("upsertSettings handles multiple keys", () => {
    upsertSettings(db, {
      "graph.linkDistance": 200,
      "server.pollInterval": 2000,
    });
    const all = getAllSettings(db);
    expect(all["graph.linkDistance"]).toBe(200);
    expect(all["server.pollInterval"]).toBe(2000);
  });

  test("upsertSettings overwrites existing value", () => {
    upsertSettings(db, { "graph.linkDistance": 200 });
    upsertSettings(db, { "graph.linkDistance": 300 });
    expect(getSetting(db, "graph.linkDistance")).toBe(300);
  });

  test("upsertSettings stores complex JSON values", () => {
    const colors = ["#ff0000", "#00ff00", "#0000ff"];
    upsertSettings(db, { "graph.agentColors": colors });
    expect(getSetting(db, "graph.agentColors")).toEqual(colors);
  });

  test("deleteSettings removes specific keys", () => {
    upsertSettings(db, { "graph.linkDistance": 200, "server.pollInterval": 2000 });
    deleteSettings(db, ["graph.linkDistance"]);
    expect(getSetting(db, "graph.linkDistance")).toBeNull();
    expect(getSetting(db, "server.pollInterval")).toBe(2000);
  });

  test("deleteAllSettings clears all settings", () => {
    upsertSettings(db, { "graph.linkDistance": 200, "server.pollInterval": 2000 });
    deleteAllSettings(db);
    expect(getAllSettings(db)).toEqual({});
  });

  test("getSetting returns null for missing key", () => {
    expect(getSetting(db, "nonexistent")).toBeNull();
  });
});
