// test/server/config.test.ts
import { describe, test, expect } from "bun:test";
import { loadConfig } from "../../src/server/config";

describe("loadConfig", () => {
  test("returns defaults when no env vars set", () => {
    const config = loadConfig({});
    expect(config.dataDir).toBe("/data");
    expect(config.port).toBe(3000);
    expect(config.watchMode).toBe("auto");
    expect(config.pollInterval).toBe(1000);
    expect(config.otelEnabled).toBe(false);
    expect(config.otelPort).toBe(4317);
  });

  test("reads from env vars", () => {
    const config = loadConfig({
      CT_DATA_DIR: "/custom/data",
      CT_PORT: "8080",
      CT_WATCH_MODE: "poll",
      CT_POLL_INTERVAL: "500",
      CT_OTEL_ENABLED: "true",
      CT_OTEL_PORT: "4318",
    });
    expect(config.dataDir).toBe("/custom/data");
    expect(config.port).toBe(8080);
    expect(config.watchMode).toBe("poll");
    expect(config.pollInterval).toBe(500);
    expect(config.otelEnabled).toBe(true);
    expect(config.otelPort).toBe(4318);
  });

  test("derives sub-paths from dataDir", () => {
    const config = loadConfig({ CT_DATA_DIR: "/data" });
    expect(config.projectsDir).toBe("/data/projects");
    expect(config.sessionsDir).toBe("/data/sessions");
    expect(config.teamsDir).toBe("/data/teams");
    expect(config.tasksDir).toBe("/data/tasks");
  });
});
