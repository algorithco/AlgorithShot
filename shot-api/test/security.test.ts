import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { buildApp } from "../src/app.ts";
import { accountFixture, DEVICE_ID } from "./support/account.ts";

test("public login configuration works while Account is unconfigured without granting access", async (t) => {
  const fixture = await accountFixture();
  t.after(() => fixture.app.close());
  const response = await fixture.app.inject({ url: "/api/v1/auth/config" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().registrationRequired, true);
  assert.equal(response.json().clientId, "shot-desktop");
  assert.equal(response.json().redirect.host, "127.0.0.1");
  assert.equal(response.json().offline.licenseRequired, true);
  assert.ok(!response.body.includes("secret"));
  assert.equal(fixture.calls.length, 0);
});

test("unavailable trust data fails readiness, preserves liveness and does not authenticate users", async (t) => {
  const fixture = await accountFixture();
  t.after(() => fixture.app.close());
  fixture.state.responses.set("/account/.well-known/openid-configuration", () => new Response("down", { status: 503 }));
  assert.equal((await fixture.app.inject({ url: "/ready" })).statusCode, 503);
  assert.equal((await fixture.app.inject({ url: "/health" })).statusCode, 200);
  const response = await fixture.app.inject({ url: "/api/v1/me", headers: { authorization: `Bearer ${await fixture.token()}` } });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().user, undefined);
});

test("readiness verifies both trust domains and coalesces subsequent key checks", async (t) => {
  const fixture = await accountFixture();
  t.after(() => fixture.app.close());
  for (let index = 0; index < 2; index++) assert.equal((await fixture.app.inject({ url: "/ready" })).statusCode, 200);
  assert.equal(fixture.calls.filter((call) => call.url.endsWith("/account/jwks")).length, 1);
  assert.equal(fixture.calls.filter((call) => call.url.endsWith("/v1/licenses/jwks.json")).length, 1);
});

test("the global IP limit ignores spoofed forwarding headers and does not block health", async (t) => {
  const fixture = await accountFixture({ RATE_LIMIT_MAX: "2" });
  t.after(() => fixture.app.close());
  for (let index = 0; index < 3; index++) {
    const response = await fixture.app.inject({ url: "/api/v1/auth/config", headers: { "x-forwarded-for": `10.0.0.${index + 1}` } });
    assert.equal(response.statusCode, index < 2 ? 200 : 429, response.body);
  }
  assert.equal((await fixture.app.inject({ url: "/health" })).statusCode, 200);
});

test("security headers and server-generated request IDs cover successes and errors", async (t) => {
  const fixture = await accountFixture();
  t.after(() => fixture.app.close());
  for (const url of ["/health", "/api/v1/me"]) {
    const response = await fixture.app.inject({ url, headers: { "x-request-id": "caller-controlled" } });
    assert.notEqual(response.headers["x-request-id"], "caller-controlled");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.headers["x-frame-options"], "DENY");
    assert.match(String(response.headers.vary), /Authorization/);
    if (response.statusCode === 401) assert.equal(response.json().error.requestId, response.headers["x-request-id"]);
  }
});

test("operational logs do not record authorization headers, query tokens, profile data or request bodies", async (t) => {
  const fixture = await accountFixture();
  t.after(() => fixture.app.close());
  const stream = new PassThrough();
  let logs = "";
  stream.on("data", (chunk) => { logs += String(chunk); });
  const app = buildApp({ ...fixture.config, logLevel: "info" }, { fetcher: fixture.fetcher, loggerStream: stream });
  t.after(() => app.close());
  const token = await fixture.token();
  await app.inject({ url: "/api/v1/me?token=do-not-log-this-query", headers: { authorization: `Bearer ${token}`, cookie: "private-cookie=do-not-log" } });
  await app.inject({ method: "POST", url: "/api/v1/me/offline-license", payload: { deviceId: DEVICE_ID, password: "do-not-log-this-password" }, headers: { authorization: `Bearer ${token}` } });
  assert.match(logs, /Request completed/);
  for (const secret of [token, "do-not-log", "person@example.test", "Shot User", DEVICE_ID]) assert.ok(!logs.includes(secret), secret.slice(0, 20));
});

test("documentation can be disabled without disabling authorization or health", async (t) => {
  const fixture = await accountFixture({ DOCS_ENABLED: "false" });
  t.after(() => fixture.app.close());
  for (const url of ["/docs/", "/openapi.json", "/docs/json"]) assert.equal((await fixture.app.inject({ url })).statusCode, 404);
  assert.equal((await fixture.app.inject({ url: "/api/v1/me" })).statusCode, 401);
  assert.equal((await fixture.app.inject({ url: "/health" })).statusCode, 200);
});

test("expired public trust caches cannot keep authenticating after a failed key refresh", async (t) => {
  const fixture = await accountFixture({ ACCOUNT_METADATA_CACHE_MS: "1000" });
  t.after(() => fixture.app.close());
  const token = await fixture.token();
  assert.equal((await fixture.app.inject({ url: "/api/v1/me", headers: { authorization: `Bearer ${token}` } })).statusCode, 200);
  fixture.state.responses.set("/account/jwks", () => new Response("down", { status: 503 }));
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const response = await fixture.app.inject({ url: "/api/v1/me", headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 503, response.body);
  assert.equal(response.json().user, undefined);
});

test("unsupported content types remain safe client errors", async (t) => {
  const fixture = await accountFixture();
  t.after(() => fixture.app.close());
  const response = await fixture.app.inject({ method: "POST", url: "/api/v1/me/offline-license", headers: { "content-type": "application/xml" }, payload: "<secret>do-not-echo</secret>" });
  assert.equal(response.statusCode, 415, response.body);
  assert.equal(response.json().error.code, "unsupported_media_type");
  assert.ok(!response.body.includes("do-not-echo"));
});
