import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { buildApp } from "../src/app.ts";
import { accountFixture, DEVICE_ID } from "./support/account.ts";

const redisUrl = process.env.TEST_REDIS_URL;

test("Redis shares the IP budget across independent API instances", { skip: !redisUrl }, async (t) => {
  const fixture = await accountFixture({ REDIS_URL: redisUrl!, RATE_LIMIT_MAX: "2", RATE_LIMIT_NAMESPACE: `shot-api:test:${randomUUID()}:` });
  const second = buildApp(fixture.config, { fetcher: fixture.fetcher });
  t.after(async () => { await Promise.all([fixture.app.close(), second.close()]); });
  assert.equal((await fixture.app.inject({ url: "/api/v1/auth/config" })).statusCode, 200);
  assert.equal((await second.inject({ url: "/api/v1/auth/config" })).statusCode, 200);
  const exhausted = await second.inject({ url: "/api/v1/auth/config" });
  assert.equal(exhausted.statusCode, 429, exhausted.body);
  assert.equal((await fixture.app.inject({ url: "/health" })).statusCode, 200);
});

test("Redis shares the per-user license budget across API instances and IPs", { skip: !redisUrl }, async (t) => {
  const fixture = await accountFixture({ REDIS_URL: redisUrl!, LICENSE_RATE_LIMIT_MAX: "1", RATE_LIMIT_NAMESPACE: `shot-api:test:${randomUUID()}:` });
  const second = buildApp(fixture.config, { fetcher: fixture.fetcher });
  t.after(async () => { await Promise.all([fixture.app.close(), second.close()]); });
  const token = await fixture.token();
  const payload = { deviceId: DEVICE_ID };
  const headers = { authorization: `Bearer ${token}` };
  assert.equal((await fixture.app.inject({ method: "POST", url: "/api/v1/me/offline-license", payload, headers, remoteAddress: "127.0.0.2" })).statusCode, 200);
  const denied = await second.inject({ method: "POST", url: "/api/v1/me/offline-license", payload, headers, remoteAddress: "127.0.0.3" });
  assert.equal(denied.statusCode, 429, denied.body);
  assert.ok(Number(denied.headers["retry-after"]) > 0);
  assert.equal(fixture.calls.filter((call) => call.method === "POST").length, 1);
});
