// src/server/config.ts
export interface Config {
  dataDir: string;
  projectsDir: string;
  sessionsDir: string;
  teamsDir: string;
  tasksDir: string;
  port: number;
  watchMode: "auto" | "native" | "poll";
  pollInterval: number;
  otelEnabled: boolean;
  otelPort: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const dataDir = env.CT_DATA_DIR ?? "/data";
  return {
    dataDir,
    projectsDir: `${dataDir}/projects`,
    sessionsDir: `${dataDir}/sessions`,
    teamsDir: `${dataDir}/teams`,
    tasksDir: `${dataDir}/tasks`,
    port: parseInt(env.CT_PORT ?? "3000", 10),
    watchMode: (env.CT_WATCH_MODE as Config["watchMode"]) ?? "auto",
    pollInterval: parseInt(env.CT_POLL_INTERVAL ?? "1000", 10),
    otelEnabled: env.CT_OTEL_ENABLED === "true",
    otelPort: parseInt(env.CT_OTEL_PORT ?? "4317", 10),
  };
}
