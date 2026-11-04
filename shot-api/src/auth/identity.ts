import { createLocalJWKSet, decodeProtectedHeader, errors, importJWK, jwtVerify, type JSONWebKeySet, type JWTPayload, type JWTVerifyOptions } from "jose";
import type { ApiConfig } from "../config.ts";
import { SHOT_SCOPE } from "../config.ts";
import { ApiError, contractError, unauthorized } from "../errors.ts";
import { AccountCache } from "../account/cache.ts";
import { AccountHttp, record } from "../account/http.ts";

export interface AccountMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  revocation_endpoint?: string;
  end_session_endpoint?: string;
}

export interface AuthUser {
  sub: string;
  email: string;
  name: string | null;
  givenName: string | null;
  familyName: string | null;
  clientId: string;
  grantId: string | null;
  authTime: number | null;
  expiresAt: number;
  issuedAt: number;
  scopes: ReadonlySet<string>;
  accessToken: string;
}

type KeyResolver = ReturnType<typeof createLocalJWKSet>;

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function optionalProfileText(value: unknown, maximum: number): boolean {
  return value === undefined || (typeof value === "string" && value.length <= maximum);
}

function publicKeySet(body: unknown): JSONWebKeySet {
  if (!record(body) || !Array.isArray(body.keys) || body.keys.length > 32) throw contractError();
  const keys = body.keys.filter((key: unknown) => record(key) && key.kty === "EC" && key.crv === "P-256" &&
    (key.alg === undefined || key.alg === "ES256") && (key.use === undefined || key.use === "sig") &&
    (key.key_ops === undefined || (Array.isArray(key.key_ops) && key.key_ops.includes("verify"))));
  if (!keys.length || keys.some((key) => !boundedString(key.kid, 128) || typeof key.x !== "string" || typeof key.y !== "string" || key.d !== undefined) ||
      new Set(keys.map((key) => key.kid)).size !== keys.length) throw contractError();
  return { keys } as JSONWebKeySet;
}

export class AccountIdentity {
  readonly config: ApiConfig;
  readonly http: AccountHttp;
  readonly metadata: AccountCache<AccountMetadata>;
  readonly accessKeys: AccountCache<KeyResolver>;
  readonly licenseKeys: AccountCache<KeyResolver>;

  constructor(config: ApiConfig, http: AccountHttp) {
    this.config = config;
    this.http = http;
    this.metadata = new AccountCache(config.account.cacheMs, config.account.jwksCooldownMs, () => this.discover());
    this.accessKeys = new AccountCache(config.account.cacheMs, config.account.jwksCooldownMs, async () => {
      const metadata = await this.metadata.get();
      return this.loadKeys(metadata.jwks_uri);
    });
    this.licenseKeys = new AccountCache(config.account.cacheMs, config.account.jwksCooldownMs, () =>
      this.loadKeys(`${config.account.apiBaseUrl}/v1/licenses/jwks.json`));
  }

  private endpoint(value: unknown): string {
    if (typeof value !== "string") throw contractError();
    let url: URL;
    try { url = new URL(value); } catch { throw contractError(); }
    if (url.origin !== new URL(this.config.account.issuer).origin || url.username || url.password || url.hash) throw contractError();
    return url.href;
  }

  private async discover(): Promise<AccountMetadata> {
    const { body } = await this.http.json(`${this.config.account.issuer}/.well-known/openid-configuration`);
    if (!record(body) || body.issuer !== this.config.account.issuer ||
        !Array.isArray(body.code_challenge_methods_supported) || !body.code_challenge_methods_supported.includes("S256") ||
        !Array.isArray(body.id_token_signing_alg_values_supported) || !body.id_token_signing_alg_values_supported.includes("ES256")) throw contractError();
    return {
      issuer: this.config.account.issuer,
      authorization_endpoint: this.endpoint(body.authorization_endpoint),
      token_endpoint: this.endpoint(body.token_endpoint),
      jwks_uri: this.endpoint(body.jwks_uri),
      ...(body.revocation_endpoint !== undefined ? { revocation_endpoint: this.endpoint(body.revocation_endpoint) } : {}),
      ...(body.end_session_endpoint !== undefined ? { end_session_endpoint: this.endpoint(body.end_session_endpoint) } : {}),
    };
  }

  private async loadKeys(url: string): Promise<KeyResolver> {
    const { body } = await this.http.json(url);
    const keys = publicKeySet(body);
    try { await Promise.all(keys.keys.map((key) => importJWK(key, "ES256"))); }
    catch { throw contractError(); }
    return createLocalJWKSet(keys);
  }

  private async verify(token: string, keys: AccountCache<KeyResolver>, options: JWTVerifyOptions): Promise<JWTPayload> {
    const first = await keys.get();
    try { return (await jwtVerify(token, first, options)).payload; }
    catch (error) {
      if (!(error instanceof errors.JWKSNoMatchingKey)) throw error;
      const refreshed = await keys.get(true);
      return (await jwtVerify(token, refreshed, options)).payload;
    }
  }

  async accessToken(token: string): Promise<AuthUser> {
    try {
      if (token.length > 16384) throw unauthorized();
      const header = decodeProtectedHeader(token);
      if (header.typ !== "at+jwt" || header.alg !== "ES256" || !boundedString(header.kid, 128)) throw unauthorized();
      const payload = await this.verify(token, this.accessKeys, {
        issuer: this.config.account.issuer, audience: this.config.account.audience, algorithms: ["ES256"],
        requiredClaims: ["sub", "iat", "exp", "client_id", "scope", "email_verified", "email"],
        clockTolerance: this.config.account.clockToleranceSeconds, maxTokenAge: 600,
      });
      if (!boundedString(payload.sub, 255) || !boundedString(payload.client_id, 64) ||
          !this.config.account.clientIds.includes(payload.client_id) || !boundedString(payload.scope, 2048) ||
          !boundedString(payload.email, 320) || payload.nonce !== undefined || payload.at_hash !== undefined ||
          !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
          (payload.exp as number) <= (payload.iat as number) || (payload.exp as number) - (payload.iat as number) > 600 ||
          !optionalProfileText(payload.name, 200) || !optionalProfileText(payload.given_name, 100) || !optionalProfileText(payload.family_name, 100) ||
          (payload.grant_id !== undefined && !boundedString(payload.grant_id, 255)) ||
          (payload.auth_time !== undefined && (!Number.isSafeInteger(payload.auth_time) || (payload.auth_time as number) < 0 || (payload.auth_time as number) > Date.now() / 1000 + this.config.account.clockToleranceSeconds))) throw unauthorized();
      if (payload.email_verified !== true) throw new ApiError(403, "email_verification_required", "Verify your email in Algorithco Account.");
      // OAuth scopes use ASCII spaces, not arbitrary Unicode whitespace.
      if (!/^[\x21\x23-\x5B\x5D-\x7E]+(?: [\x21\x23-\x5B\x5D-\x7E]+)*$/.test(payload.scope)) throw unauthorized();
      const scopes = new Set(payload.scope.split(" "));
      if (!scopes.has(SHOT_SCOPE)) throw new ApiError(403, "insufficient_scope", "The shot:access scope is required.");
      return {
        sub: payload.sub, email: payload.email, name: typeof payload.name === "string" ? payload.name : null,
        givenName: typeof payload.given_name === "string" ? payload.given_name : null,
        familyName: typeof payload.family_name === "string" ? payload.family_name : null,
        clientId: payload.client_id, grantId: typeof payload.grant_id === "string" ? payload.grant_id : null,
        authTime: typeof payload.auth_time === "number" ? payload.auth_time : null,
        issuedAt: payload.iat as number, expiresAt: payload.exp as number, scopes, accessToken: token,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw unauthorized();
    }
  }

  async license(token: string, user: AuthUser, deviceId: string): Promise<JWTPayload> {
    try {
      if (token.length > 16384) throw contractError();
      const header = decodeProtectedHeader(token);
      if (header.typ !== "JWT" || header.alg !== "ES256" || !boundedString(header.kid, 128)) throw contractError();
      const payload = await this.verify(token, this.licenseKeys, {
        issuer: this.config.account.issuer, audience: this.config.offline.audience, algorithms: ["ES256"],
        requiredClaims: ["sub", "iat", "exp", "jti", "product", "plan", "limits", "device_id"],
        clockTolerance: this.config.account.clockToleranceSeconds, maxTokenAge: this.config.offline.maxAgeSeconds,
      });
      if (payload.sub !== user.sub || payload.product !== "shot" || payload.plan !== "free" || payload.device_id !== deviceId ||
          !boundedString(payload.jti, 128) || !record(payload.limits) ||
          !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
          (payload.exp as number) <= Date.now() / 1000 || (payload.exp as number) <= (payload.iat as number) ||
          (payload.exp as number) - (payload.iat as number) > this.config.offline.maxAgeSeconds) throw contractError();
      return payload;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, "invalid_offline_license", "Account returned an invalid offline license.");
    }
  }

  async ready(): Promise<void> {
    await Promise.all([this.accessKeys.get(), this.licenseKeys.get()]);
  }
}
