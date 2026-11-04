import { randomUUID } from "node:crypto";
import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose";
import { buildApp } from "../../src/app.ts";
import { readConfig, SHOT_SCOPES } from "../../src/config.ts";

export const USER_ID = "019a0000-0000-7000-8000-000000000001";
export const DEVICE_ID = "63205911-9b2b-40b6-9123-70e29994af66";

export async function accountFixture(env: Record<string, string> = {}) {
  let accessPair = await generateKeyPair("ES256");
  let accessKid = "oidc-1";
  let accessPublic = await exportJWK(accessPair.publicKey);
  const licensePair = await generateKeyPair("ES256");
  const licensePublic = await exportJWK(licensePair.publicKey);
  const config = readConfig({
    NODE_ENV: "test", LOG_LEVEL: "silent", DOCS_ENABLED: "false", ACCOUNT_ISSUER: "http://127.0.0.1:18432/account",
    ACCOUNT_API_BASE_URL: "http://127.0.0.1:18432", ACCOUNT_WEB_URL: "http://127.0.0.1:18432",
    ACCOUNT_JWKS_COOLDOWN_MS: "0", ...env,
  });
  const origin = config.account.apiBaseUrl;
  const issuer = config.account.issuer;
  const calls: { url: string; method: string; authorization: string | null; body: string | undefined }[] = [];
  const state = {
    metadata: {} as Record<string, unknown>,
    entitlement: { product: "shot", plan: "free", status: "active", limits: {}, validUntil: null, owner: { type: "user", id: USER_ID } } as Record<string, unknown>,
    entitlementsEmpty: false,
    licenseClaims: {} as Record<string, unknown>,
    licenseHeader: {} as Record<string, string>,
    licenseWithOidcKey: false,
    expiresAtOffsetMs: 500,
    responses: new Map<string, () => Response | Promise<Response>>(),
  };
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const path = new URL(url).pathname;
    const authorization = new Headers(init?.headers).get("authorization");
    calls.push({ url, method: init?.method ?? "GET", authorization, body: typeof init?.body === "string" ? init.body : undefined });
    if (init?.redirect !== "error") throw new Error("Fixture requires redirects to be disabled");
    const overridden = state.responses.get(path);
    if (overridden) return overridden();
    if (path === "/account/.well-known/openid-configuration") return json({
      issuer, authorization_endpoint: `${issuer}/auth`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
      revocation_endpoint: `${issuer}/token/revocation`, end_session_endpoint: `${issuer}/session/end`,
      code_challenge_methods_supported: ["S256"], id_token_signing_alg_values_supported: ["ES256"],
      scopes_supported: SHOT_SCOPES, ...state.metadata,
    });
    if (path === "/account/jwks") return json({ keys: [{ ...accessPublic, alg: "ES256", use: "sig", kid: accessKid }] });
    if (path === "/v1/licenses/jwks.json") return json({ keys: [{ ...licensePublic, alg: "ES256", use: "sig", kid: "license-1" }] });
    if (path === "/v1/entitlements") return json({ entitlements: state.entitlementsEmpty ? [] : [state.entitlement] });
    if (path === "/v1/licenses") {
      const body = JSON.parse(String(init?.body)) as { product: string; device_id: string };
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        iss: issuer, aud: config.offline.audience, sub: decodeJwt(authorization!.slice(7)).sub!,
        iat: now, exp: now + config.offline.maxAgeSeconds, jti: randomUUID(),
        product: body.product, plan: "free", device_id: body.device_id, limits: {}, ...state.licenseClaims,
      };
      const token = await new SignJWT(claims).setProtectedHeader({ alg: "ES256", typ: "JWT", kid: state.licenseWithOidcKey ? accessKid : "license-1", ...state.licenseHeader })
        .sign(state.licenseWithOidcKey ? accessPair.privateKey : licensePair.privateKey);
      return json({ license: token, expires_at: new Date(Number(claims.exp) * 1000 + state.expiresAtOffsetMs).toISOString() });
    }
    throw new Error(`Unexpected fixture URL: ${origin}${path}`);
  };
  const app = buildApp(config, { fetcher });
  return {
    app, config, state, calls, fetcher, json,
    async token(overrides: Record<string, unknown> = {}, header: Record<string, string> = {}) {
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({
        iss: issuer, aud: config.account.audience, sub: USER_ID, iat: now, exp: now + 600,
        client_id: "shot-desktop", scope: SHOT_SCOPES.join(" "), email: "person@example.test", email_verified: true,
        name: "Shot User", given_name: "Shot", family_name: "User", grant_id: "native-grant-1", auth_time: now, ...overrides,
      }).setProtectedHeader({ alg: "ES256", typ: "at+jwt", kid: accessKid, ...header }).sign(accessPair.privateKey);
    },
    async rotateAccessKey() {
      accessPair = await generateKeyPair("ES256");
      accessPublic = await exportJWK(accessPair.publicKey);
      accessKid = `oidc-${randomUUID()}`;
    },
  };
}
