import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.ts";
import { readConfig } from "../src/config.ts";

function createApp() {
  return buildApp(readConfig({ LOG_LEVEL: "silent" }));
}

test("health check responds with JSON through the HTTP router", async (t) => {
  const app = createApp();
  t.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] ?? "", /application\/json/);
  assert.deepEqual(response.json(), { status: "ok", service: "shot-api" });
});

test("the versioned API exposes its service and API version", async (t) => {
  const app = createApp();
  t.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/api/v1" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { service: "shot-api", apiVersion: "v1" });
});

test("unknown routes return an HTTP 404", async (t) => {
  const app = createApp();
  t.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/api/v1/missing" });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().statusCode, 404);
});

test("desktop development and packaged origins receive CORS headers", async (t) => {
  const app = createApp();
  t.after(() => app.close());
  for (const origin of readConfig({}).corsOrigins) {
    const response = await app.inject({ method: "GET", url: "/health", headers: { origin } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["access-control-allow-origin"], origin);
  }
});

test("CORS preflight accepts an allowed desktop origin", async (t) => {
  const app = createApp();
  t.after(() => app.close());
  const response = await app.inject({
    method: "OPTIONS",
    url: "/api/v1",
    headers: {
      origin: "http://localhost:1420",
      "access-control-request-method": "GET",
    },
  });
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["access-control-allow-origin"], "http://localhost:1420");
});

test("an unrelated origin does not receive CORS permission", async (t) => {
  const app = createApp();
  t.after(() => app.close());
  const response = await app.inject({
    method: "GET",
    url: "/health",
    headers: { origin: "https://unrelated.example" },
  });
  assert.equal(response.headers["access-control-allow-origin"], undefined);
});

test("an empty CORS allowlist does not grant cross-origin access", async (t) => {
  const app = buildApp(readConfig({ LOG_LEVEL: "silent", CORS_ORIGINS: "" }));
  t.after(() => app.close());
  const response = await app.inject({
    method: "GET",
    url: "/health",
    headers: { origin: "http://localhost:1420" },
  });
  assert.equal(response.headers["access-control-allow-origin"], undefined);
});
