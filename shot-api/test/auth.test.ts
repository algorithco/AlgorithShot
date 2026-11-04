import assert from "node:assert/strict";
import { test } from "node:test";
import { accountFixture, DEVICE_ID, USER_ID } from "./support/account.ts";

test("verified access tokens expose account data without exposing tokens or inventing a session", async (t) => {
  const fixture = await accountFixture();
  t.after(() => fixture.app.close());
  const token = await fixture.token();
  const response = await fixture.app.inject({ url: "/api/v1/me", headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().user.id, USER_ID);
  assert.equal(response.json().user.emailVerified, true);
  assert.equal(response.json().session.grantId, "native-grant-1");
  assert.equal(response.json().account.manageUrl, `${fixture.config.account.webUrl}/app/account`);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.ok(!response.body.includes(token));
  assert.ok(!fixture.calls.some((call) => call.url.includes("/v1/entitlements")));
});

test("every protected route rejects missing credentials before contacting Account", async (t) => {
  const fixture = await accountFixture();
  t.after(() => fixture.app.close());
  for (const url of ["/api/v1/me", "/api/v1/me/access", "/api/v1/me/entitlements", "/api/v1/me/offline-license"]) {
    const response = await fixture.app.inject({ url, ...(url.endsWith("offline-license") ? { method: "POST" as const, payload: { deviceId: DEVICE_ID } } : {}) });
    assert.equal(response.statusCode, 401, response.body);
    assert.match(String(response.headers["www-authenticate"]), /Bearer/);
  }
  assert.equal(fixture.calls.length, 0);
});

const rejectedClaims: [string, Record<string, unknown>, number][] = [
  ["wrong issuer", { iss: "https://attacker.example/account" }, 401],
  ["wrong audience", { aud: "voice-desktop" }, 401],
  ["another product client on the shared audience", { client_id: "voice-desktop" }, 401],
  ["missing Shot scope", { scope: "openid profile email" }, 403],
  ["lookalike scope", { scope: "not-shot:access entitlements:read" }, 403],
  ["Unicode scope delimiter", { scope: "shot:access\u00a0entitlements:read" }, 401],
  ["unverified email", { email_verified: false }, 403],
  ["missing subject", { sub: undefined }, 401],
  ["non-string subject", { sub: 123 }, 401],
  ["ID-token nonce marker", { nonce: "untrusted" }, 401],
  ["ID-token at_hash marker", { at_hash: "untrusted" }, 401],
  ["non-string profile name", { name: { injected: true } }, 401],
  ["invalid authentication timestamp", { auth_time: -Number.MAX_SAFE_INTEGER }, 401],
  ["expired token", { iat: Math.floor(Date.now() / 1000) - 1200, exp: Math.floor(Date.now() / 1000) - 600 }, 401],
  ["future-issued token", { iat: Math.floor(Date.now() / 1000) + 60, exp: Math.floor(Date.now() / 1000) + 600 }, 401],
  ["excessive token lifetime", { exp: Math.floor(Date.now() / 1000) + 3600 }, 401],
];
for (const [name, claims, status] of rejectedClaims) {
  test(`access verification rejects ${name}`, async (t) => {
    const fixture = await accountFixture();
    t.after(() => fixture.app.close());
    const token = await fixture.token(claims);
    const response = await fixture.app.inject({ url: "/api/v1/me", headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.statusCode, status, response.body);
  });
}

test("ID tokens and algorithm-confused tokens never become API credentials", async (t) => {
  const fixture = await accountFixture();
  t.after(() => fixture.app.close());
  const idToken = await fixture.token({}, { typ: "JWT" });
  const good = await fixture.token();
  const pieces = good.split(".");
  const noneHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "at+jwt", kid: "oidc-1" })).toString("base64url");
  for (const token of [idToken, `${noneHeader}.${pieces[1]}.${pieces[2]}`, `${pieces[0]}.${pieces[1]}.${"A".repeat(86)}`, "malformed"]) {
    const response = await fixture.app.inject({ url: "/api/v1/me", headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.statusCode, 401, response.body);
  }
});

test("an account without a display name still has verified identity", async (t) => {
  const fixture = await accountFixture();
  t.after(() => fixture.app.close());
  const response = await fixture.app.inject({ url: "/api/v1/me", headers: { authorization: `Bearer ${await fixture.token({ name: "", given_name: "", family_name: "" })}` } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().user.id, USER_ID);
});

test("unknown kid refresh discovers a rotated public key", async (t) => {
  const fixture = await accountFixture();
  t.after(() => fixture.app.close());
  const first = await fixture.app.inject({ url: "/api/v1/me", headers: { authorization: `Bearer ${await fixture.token()}` } });
  assert.equal(first.statusCode, 200);
  await fixture.rotateAccessKey();
  const rotated = await fixture.app.inject({ url: "/api/v1/me", headers: { authorization: `Bearer ${await fixture.token()}` } });
  assert.equal(rotated.statusCode, 200, rotated.body);
  assert.equal(fixture.calls.filter((call) => call.url.endsWith("/account/jwks")).length, 2);
});

test("unknown kid floods cannot bypass the JWKS refresh cooldown", async (t) => {
  const fixture = await accountFixture({ ACCOUNT_JWKS_COOLDOWN_MS: "30000" });
  t.after(() => fixture.app.close());
  await fixture.app.inject({ url: "/api/v1/me", headers: { authorization: `Bearer ${await fixture.token()}` } });
  for (let index = 0; index < 4; index++) {
    const token = await fixture.token({}, { kid: `unknown-${index}`, jku: "https://attacker.example/keys" });
    assert.equal((await fixture.app.inject({ url: "/api/v1/me", headers: { authorization: `Bearer ${token}` } })).statusCode, 401);
  }
  assert.equal(fixture.calls.filter((call) => call.url.endsWith("/account/jwks")).length, 1);
  assert.ok(fixture.calls.every((call) => call.url.startsWith(fixture.config.account.apiBaseUrl)));
});

test("discovery cannot replace the issuer or send key requests to a second origin", async (t) => {
  for (const metadata of [{ issuer: "https://attacker.example" }, { jwks_uri: "https://attacker.example/jwks" }, { code_challenge_methods_supported: ["plain"] }]) {
    const fixture = await accountFixture();
    t.after(() => fixture.app.close());
    fixture.state.metadata = metadata;
    const response = await fixture.app.inject({ url: "/api/v1/me", headers: { authorization: `Bearer ${await fixture.token()}` } });
    assert.equal(response.statusCode, 503, response.body);
    assert.equal(fixture.calls.length, 1);
  }
});
