import assert from "node:assert/strict";
import { test } from "node:test";
import { accountFixture, DEVICE_ID, USER_ID } from "./support/account.ts";

test("access uses a live, subject-bound Shot entitlement and the central root API paths", async (t) => {
  const fixture = await accountFixture();
  t.after(() => fixture.app.close());
  const token = await fixture.token();
  const response = await fixture.app.inject({ url: "/api/v1/me/access", headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().plan, "free");
  assert.ok(response.json().features.includes("capture"));
  assert.equal(response.json().offline.maxAgeSeconds, 7 * 86400);
  const call = fixture.calls.find((entry) => entry.url.includes("/v1/entitlements"))!;
  assert.equal(new URL(call.url).pathname, "/v1/entitlements");
  assert.equal(new URL(call.url).searchParams.get("product"), "shot");
  assert.equal(call.authorization, `Bearer ${token}`);
});

test("entitlement scope is enforced locally before a privileged Account request", async (t) => {
  const fixture = await accountFixture();
  t.after(() => fixture.app.close());
  const response = await fixture.app.inject({ url: "/api/v1/me/access", headers: { authorization: `Bearer ${await fixture.token({ scope: "shot:access" })}` } });
  assert.equal(response.statusCode, 403);
  assert.ok(!fixture.calls.some((call) => call.url.includes("/v1/entitlements")));
});

for (const [name, changes, status] of [
  ["another product", { product: "voice" }, 503],
  ["another user", { owner: { type: "user", id: "another-user" } }, 503],
  ["revoked access", { status: "revoked" }, 403],
  ["an invalid status type", { status: ["active"] }, 403],
  ["expired access", { validUntil: "2020-01-01T00:00:00.000Z" }, 403],
  ["an unknown paid plan", { plan: "pro" }, 403],
  ["malformed limits", { limits: [] }, 503],
] as const) {
  test(`entitlements reject ${name} and cannot mint a license`, async (t) => {
    const fixture = await accountFixture();
    t.after(() => fixture.app.close());
    Object.assign(fixture.state.entitlement, changes);
    const response = await fixture.app.inject({ method: "POST", url: "/api/v1/me/offline-license", payload: { deviceId: DEVICE_ID }, headers: { authorization: `Bearer ${await fixture.token()}` } });
    assert.equal(response.statusCode, status, response.body);
    assert.ok(!fixture.calls.some((call) => new URL(call.url).pathname === "/v1/licenses"));
  });
}

test("an empty entitlement set does not silently grant the Free tier", async (t) => {
  const fixture = await accountFixture();
  t.after(() => fixture.app.close());
  fixture.state.entitlementsEmpty = true;
  const response = await fixture.app.inject({ url: "/api/v1/me/access", headers: { authorization: `Bearer ${await fixture.token()}` } });
  assert.equal(response.statusCode, 403);
});

test("offline license uses dedicated keys, binds the user/device and trusts the signed expiry", async (t) => {
  const fixture = await accountFixture();
  t.after(() => fixture.app.close());
  const token = await fixture.token();
  const response = await fixture.app.inject({ method: "POST", url: "/api/v1/me/offline-license", payload: { deviceId: DEVICE_ID }, headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().deviceId, DEVICE_ID);
  assert.equal(response.json().plan, "free");
  assert.equal(new Date(response.json().expiresAt).getUTCMilliseconds(), 0);
  const request = fixture.calls.find((call) => call.method === "POST")!;
  assert.deepEqual(JSON.parse(request.body!), { product: "shot", device_id: DEVICE_ID });
  assert.ok(fixture.calls.some((call) => call.url.endsWith("/v1/licenses/jwks.json")));
});

const invalidLicenses: [string, Record<string, unknown>][] = [
  ["another subject", { sub: "another-user" }],
  ["another product", { product: "guard" }],
  ["another device", { device_id: "another-device" }],
  ["another audience", { aud: "voice-desktop" }],
  ["another issuer", { iss: "https://attacker.example" }],
  ["an unsupported plan", { plan: "pro" }],
  ["missing license ID", { jti: undefined }],
  ["malformed limits", { limits: [] }],
  ["expired license", { iat: Math.floor(Date.now() / 1000) - 100, exp: Math.floor(Date.now() / 1000) - 50 }],
  ["excessive lifetime", { exp: Math.floor(Date.now() / 1000) + 30 * 86400 }],
];
for (const [name, claims] of invalidLicenses) {
  test(`offline license validation rejects ${name}`, async (t) => {
    const fixture = await accountFixture();
    t.after(() => fixture.app.close());
    fixture.state.licenseClaims = claims;
    const response = await fixture.app.inject({ method: "POST", url: "/api/v1/me/offline-license", payload: { deviceId: DEVICE_ID }, headers: { authorization: `Bearer ${await fixture.token()}` } });
    assert.equal(response.statusCode, 503, response.body);
    assert.equal(response.json().license, undefined);
  });
}

test("OIDC keys cannot sign offline licenses and envelope expiry cannot extend them", async (t) => {
  for (const mode of ["oidc", "expiry"] as const) {
    const fixture = await accountFixture();
    t.after(() => fixture.app.close());
    if (mode === "oidc") fixture.state.licenseWithOidcKey = true;
    else fixture.state.expiresAtOffsetMs = 60000;
    const response = await fixture.app.inject({ method: "POST", url: "/api/v1/me/offline-license", payload: { deviceId: DEVICE_ID }, headers: { authorization: `Bearer ${await fixture.token()}` } });
    assert.equal(response.statusCode, 503, response.body);
  }
});

test("product/subject injection and invalid installation IDs are rejected by the HTTP schema", async (t) => {
  const fixture = await accountFixture();
  t.after(() => fixture.app.close());
  for (const body of [{ deviceId: DEVICE_ID, product: "guard" }, { deviceId: DEVICE_ID, sub: USER_ID }, { deviceId: "" }, { deviceId: 123 }, {}]) {
    const response = await fixture.app.inject({ method: "POST", url: "/api/v1/me/offline-license", payload: body, headers: { authorization: `Bearer ${await fixture.token()}` } });
    assert.equal(response.statusCode, 400, response.body);
  }
  assert.equal(fixture.calls.length, 0);
});

test("the license user limit applies across IP addresses and returns Retry-After", async (t) => {
  const fixture = await accountFixture({ LICENSE_RATE_LIMIT_MAX: "2" });
  t.after(() => fixture.app.close());
  const token = await fixture.token();
  for (let index = 0; index < 3; index++) {
    const response = await fixture.app.inject({ method: "POST", url: "/api/v1/me/offline-license", remoteAddress: `127.0.0.${index + 1}`, payload: { deviceId: DEVICE_ID }, headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.statusCode, index < 2 ? 200 : 429, response.body);
    if (index === 2) assert.ok(Number(response.headers["retry-after"]) > 0);
  }
  assert.equal(fixture.calls.filter((call) => call.method === "POST").length, 2);
});

for (const [upstream, expected] of [[401, 401], [403, 403], [429, 503], [500, 503], [400, 503]] as const) {
  test(`Account HTTP ${upstream} cannot be mistaken for a successful offline grant`, async (t) => {
    const fixture = await accountFixture();
    t.after(() => fixture.app.close());
    fixture.state.responses.set("/v1/entitlements", () => new Response("sensitive-upstream-body", { status: upstream }));
    const response = await fixture.app.inject({ method: "POST", url: "/api/v1/me/offline-license", payload: { deviceId: DEVICE_ID }, headers: { authorization: `Bearer ${await fixture.token()}` } });
    assert.equal(response.statusCode, expected, response.body);
    assert.ok(!response.body.includes("sensitive-upstream-body"));
  });
}
