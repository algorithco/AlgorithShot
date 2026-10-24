const logLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
type LogLevel = (typeof logLevels)[number];

export interface ApiConfig {
  host: string;
  port: number;
  logLevel: LogLevel;
  corsOrigins: string[];
}

const defaultOrigins = [
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  "http://tauri.localhost",
  "tauri://localhost",
];

export function readConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  const host = (env.HOST ?? "127.0.0.1").trim();
  if (!host) throw new Error("HOST must not be empty.");

  const rawPort = (env.PORT ?? "3000").trim();
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  const logLevel = (env.LOG_LEVEL ?? "info").trim();
  if (!logLevels.some((level) => level === logLevel)) {
    throw new Error(`LOG_LEVEL must be one of: ${logLevels.join(", ")}.`);
  }

  return {
    host,
    port,
    logLevel: logLevel as LogLevel,
    corsOrigins: env.CORS_ORIGINS === undefined
      ? [...defaultOrigins]
      : env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  };
}
