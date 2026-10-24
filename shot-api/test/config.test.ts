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
  assert.deepEqual(readConfig({
    HOST: " 0.0.0.0 ",
    PORT: "8080",
    LOG_LEVEL: "warn",
    CORS_ORIGINS: " https://app.example, http://localhost:1420, ",
  }), {
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
