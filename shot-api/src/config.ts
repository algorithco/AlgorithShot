export const SHOT_PRODUCT = "shot";
export const SHOT_CLIENT_ID = "shot-desktop";
export const SHOT_SCOPE = "shot:access";
export const SHOT_SCOPES = ["openid", "profile", "email", "offline_access", SHOT_SCOPE, "entitlements:read", "license:issue"] as const;

const logLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
type Environment = Record<string, string | undefined>;

export interface ApiConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  logLevel: (typeof logLevels)[number];
  corsOrigins: string[];
  docsEnabled: boolean;
  trustProxy: false | number;
  redisUrl: string | undefined;
  rateLimitMax: number;
  rateLimitNamespace: string;
  licenseRateLimitMax: number;
  account: {
    issuer: string;
    apiBaseUrl: string;
    webUrl: string;
    audience: string;
    clientIds: string[];
    timeoutMs: number;
    cacheMs: number;
    jwksCooldownMs: number;
    clockToleranceSeconds: number;
  };
  offline: {
    audience: string;
    maxAgeSeconds: number;
    refreshAfterSeconds: number;
  };
}

export function isLoopback(hostname: string): boolean {
  return ["127.0.0.1", "[::1]", "localhost"].includes(hostname);
}

function integer(env: Environment, name: string, fallback: number, min: number, max: number): number {
  const raw = (env[name] ?? String(fallback)).trim();
  const number = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return number;
}

function boolean(env: Environment, name: string, fallback: boolean): boolean {
  const raw = (env[name] ?? String(fallback)).trim();
  if (raw !== "true" && raw !== "false") throw new Error(`${name} must be true or false.`);
  return raw === "true";
}

function text(env: Environment, name: string, fallback: string): string {
  const value = (env[name] ?? fallback).trim();
  if (!value) throw new Error(`${name} must not be empty.`);
  return value;
}

function trustedUrl(raw: string, name: string, production: boolean, originOnly = false): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`${name} must be a valid URL.`); }
  if (url.username || url.password || url.search || url.hash || raw.includes("*") ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && !production && isLoopback(url.hostname))) ||
      (originOnly && url.pathname !== "/")) {
    throw new Error(`${name} must be an HTTPS ${originOnly ? "origin" : "URL"} (loopback HTTP is development-only).`);
  }
  return url.href.replace(/\/$/, "");
}

export function readConfig(env: Environment = process.env): ApiConfig {
  const nodeEnv = text(env, "NODE_ENV", "development");
  if (nodeEnv !== "development" && nodeEnv !== "test" && nodeEnv !== "production") {
    throw new Error("NODE_ENV must be development, test or production.");
  }
  const production = nodeEnv === "production";
  if (production) {
    for (const name of ["ACCOUNT_ISSUER", "ACCOUNT_API_BASE_URL", "ACCOUNT_WEB_URL", "TRUST_PROXY", "REDIS_URL"]) {
      if (!env[name]?.trim()) throw new Error(`${name} must be explicitly configured in production.`);
    }
  }
  const logLevel = text(env, "LOG_LEVEL", "info");
  if (!logLevels.some((level) => level === logLevel)) throw new Error(`LOG_LEVEL must be one of: ${logLevels.join(", ")}.`);
  const issuer = trustedUrl(text(env, "ACCOUNT_ISSUER", "https://algorithco.trqsh.uz/account"), "ACCOUNT_ISSUER", production);
  const apiBaseUrl = trustedUrl(text(env, "ACCOUNT_API_BASE_URL", new URL(issuer).origin), "ACCOUNT_API_BASE_URL", production, true);
  const webUrl = trustedUrl(text(env, "ACCOUNT_WEB_URL", new URL(issuer).origin), "ACCOUNT_WEB_URL", production, true);
  // A bearer token must never follow a configured redirect to another host.
  if (new URL(apiBaseUrl).origin !== new URL(issuer).origin) throw new Error("ACCOUNT_API_BASE_URL must share the ACCOUNT_ISSUER origin.");
  const clientIds = text(env, "ACCOUNT_CLIENT_IDS", SHOT_CLIENT_ID).split(",").map((id) => id.trim());
  if (!clientIds.includes(SHOT_CLIENT_ID) || clientIds.some((id) => !/^[a-z][a-z0-9_-]{0,63}$/.test(id))) {
    throw new Error("ACCOUNT_CLIENT_IDS must contain shot-desktop and valid client IDs.");
  }
  const defaultOrigins = ["http://localhost:1420", "http://127.0.0.1:1420", "http://tauri.localhost", "tauri://localhost"];
  const corsOrigins = env.CORS_ORIGINS === undefined ? (production ? [] : defaultOrigins) : env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);
  for (const origin of corsOrigins) {
    if (["tauri://localhost", "http://tauri.localhost"].includes(origin)) continue;
    if (trustedUrl(origin, "CORS_ORIGINS", production, true) !== origin) throw new Error("CORS_ORIGINS must contain exact origins without trailing slashes.");
  }
  const proxyHops = integer(env, "TRUST_PROXY", 0, 0, 10);
  const redisUrl = env.REDIS_URL?.trim() || undefined;
  if (redisUrl) {
    let parsed: URL;
    try { parsed = new URL(redisUrl); } catch { throw new Error("REDIS_URL must be a Redis URL."); }
    if (!["redis:", "rediss:"].includes(parsed.protocol) || !parsed.hostname || parsed.hash) throw new Error("REDIS_URL must use redis:// or rediss://.");
  }
  const maxAgeSeconds = integer(env, "OFFLINE_MAX_AGE_SECONDS", 7 * 86400, 3600, 30 * 86400);
  const rateLimitNamespace = text(env, "RATE_LIMIT_NAMESPACE", "shot-api:rate:");
  if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(rateLimitNamespace)) throw new Error("RATE_LIMIT_NAMESPACE must be a short Redis key prefix.");
  const refreshAfterSeconds = integer(env, "OFFLINE_REFRESH_AFTER_SECONDS", Math.min(86400, Math.floor(maxAgeSeconds / 2)), 60, maxAgeSeconds);
  return {
    nodeEnv,
    host: text(env, "HOST", "127.0.0.1"),
    port: integer(env, "PORT", 3000, 1, 65535),
    logLevel: logLevel as ApiConfig["logLevel"],
    corsOrigins,
    docsEnabled: boolean(env, "DOCS_ENABLED", !production),
    trustProxy: proxyHops || false,
    redisUrl,
    rateLimitMax: integer(env, "RATE_LIMIT_MAX", 120, 1, 10000),
    rateLimitNamespace,
    licenseRateLimitMax: integer(env, "LICENSE_RATE_LIMIT_MAX", 5, 1, 60),
    account: {
      issuer, apiBaseUrl, webUrl,
      audience: text(env, "ACCOUNT_AUDIENCE", "algorithco-platform-api"),
      clientIds: [...new Set(clientIds)],
      timeoutMs: integer(env, "ACCOUNT_TIMEOUT_MS", 5000, 100, 15000),
      cacheMs: integer(env, "ACCOUNT_METADATA_CACHE_MS", 600000, 1000, 3600000),
      jwksCooldownMs: integer(env, "ACCOUNT_JWKS_COOLDOWN_MS", 30000, 0, 60000),
      clockToleranceSeconds: integer(env, "ACCOUNT_CLOCK_TOLERANCE_SECONDS", 5, 0, 30),
    },
    offline: {
      audience: text(env, "LICENSE_AUDIENCE", "algorithco-products"),
      maxAgeSeconds, refreshAfterSeconds,
    },
  };
}
