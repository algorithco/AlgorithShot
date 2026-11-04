import assert from "node:assert/strict";
import { test } from "node:test";
import { readConfig } from "../src/config.ts";

test("defaults bind locally and use the documented API port", () => {
  const config = readConfig({});
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 3000);
  assert.equal(config.logLevel, "info");
});

test("environment values configure the listener, logs and exact CORS origins", () => {
  const config = readConfig({
    HOST: " 0.0.0.0 ",
    PORT: "8080",
    LOG_LEVEL: "warn",
    CORS_ORIGINS: " https://app.example, http://localhost:1420, ",
  });
  assert.deepEqual({ host: config.host, port: config.port, logLevel: config.logLevel, corsOrigins: config.corsOrigins }, {
    host: "0.0.0.0",
    port: 8080,
    logLevel: "warn",
    corsOrigins: ["https://app.example", "http://localhost:1420"],
  });
});

test("invalid ports fail before the server starts", () => {
  for (const port of ["", "0", "-1", "65536", "3.5", "3000abc", "NaN"]) {
    assert.throws(() => readConfig({ PORT: port }), /PORT must be an integer/);
  }
});

test("invalid hosts and log levels fail before the server starts", () => {
  assert.throws(() => readConfig({ HOST: " " }), /HOST must not be empty/);
  assert.throws(() => readConfig({ LOG_LEVEL: "verbose" }), /LOG_LEVEL must be one of/);
});

const production = { NODE_ENV: "production", ACCOUNT_ISSUER: "https://account.example/account", ACCOUNT_API_BASE_URL: "https://account.example", ACCOUNT_WEB_URL: "https://company.example", TRUST_PROXY: "1", REDIS_URL: "redis://cache.internal:6379" };

test("production requires explicit Account and shared Redis configuration with docs disabled", () => {
  const config = readConfig(production);
  assert.equal(config.docsEnabled, false);
  assert.deepEqual(config.corsOrigins, []);
  assert.equal(config.trustProxy, 1);
  for (const key of ["ACCOUNT_ISSUER", "ACCOUNT_API_BASE_URL", "ACCOUNT_WEB_URL", "TRUST_PROXY", "REDIS_URL"]) {
    assert.throws(() => readConfig({ ...production, [key]: "" }), new RegExp(key));
  }
});

test("unsafe URLs, wildcard CORS and secrets embedded in URLs are rejected", () => {
  for (const value of ["http://account.example/account", "https://user:password@account.example/account", "https://account.example/account#fragment", "https://account.example/account?issuer=other"]) {
    assert.throws(() => readConfig({ ACCOUNT_ISSUER: value }), /ACCOUNT_ISSUER/);
  }
  assert.throws(() => readConfig({ ACCOUNT_API_BASE_URL: "https://different.example" }), /share/);
  assert.throws(() => readConfig({ CORS_ORIGINS: "*" }), /CORS_ORIGINS/);
  assert.throws(() => readConfig({ REDIS_URL: "https://cache.example" }), /REDIS_URL/);
  assert.throws(() => readConfig({ ...production, ACCOUNT_ISSUER: "http://127.0.0.1/account", ACCOUNT_API_BASE_URL: "http://127.0.0.1" }), /ACCOUNT_ISSUER/);
});

test("policy knobs cannot silently disable login, exceed offline bounds or trust every proxy", () => {
  for (const [key, value] of [["TRUST_PROXY", "true"], ["DOCS_ENABLED", "yes"], ["OFFLINE_MAX_AGE_SECONDS", "0"], ["OFFLINE_MAX_AGE_SECONDS", "99999999"], ["ACCOUNT_CLIENT_IDS", "voice-desktop"], ["ACCOUNT_CLOCK_TOLERANCE_SECONDS", "3600"]]) {
    assert.throws(() => readConfig({ [key!]: value! }), new RegExp(key!));
  }
});
