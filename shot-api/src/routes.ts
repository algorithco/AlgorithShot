import { createHash } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { SHOT_CLIENT_ID, SHOT_PRODUCT, SHOT_SCOPES, type ApiConfig } from "./config.ts";
import { AccountClient, SHOT_FEATURES } from "./account/client.ts";
import type { AccountIdentity } from "./auth/identity.ts";
import { currentUser, requireUser } from "./auth/require-user.ts";
import { ApiError, errorSchema } from "./errors.ts";
import { bearerSecurity, boolean, entitlementSchema, integer, limits, nullableString, object, offlinePolicySchema, protectedErrors, string } from "./routes/schemas.ts";

export function apiRoutes(config: ApiConfig, identity: AccountIdentity, account: AccountClient, redisReady: () => boolean): FastifyPluginAsync {
  return async (app) => {
    app.get("/", { schema: { hide: true } }, async (_request, reply) => {
      return reply.redirect(config.docsEnabled ? "/docs/" : "/health");
    });

    if (config.docsEnabled) app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());

    app.get("/health", {
      config: { rateLimit: false },
      schema: {
        operationId: "getHealth",
        tags: ["Health"],
        summary: "Check API health",
        description: "Process liveness. Account or Redis outages do not change this response.",
        response: {
          200: {
            description: "The API is running.",
            type: "object",
            additionalProperties: false,
            required: ["status", "service"],
            properties: {
              status: { type: "string", enum: ["ok"], example: "ok" },
              service: { type: "string", enum: ["shot-api"], example: "shot-api" },
            },
          },
        },
      },
    }, async () => ({ status: "ok", service: "shot-api" }));

    app.get("/api/v1", {
      schema: {
        operationId: "getServiceInfo",
        tags: ["Service"],
        summary: "Get API information",
        description: "Returns the backend service name and the API version.",
        response: {
          200: {
            description: "Service information.",
            type: "object",
            additionalProperties: false,
            required: ["service", "apiVersion"],
            properties: {
              service: { type: "string", enum: ["shot-api"], example: "shot-api" },
              apiVersion: { type: "string", enum: ["v1"], example: "v1" },
            },
          },
        },
      },
    }, async () => ({ service: "shot-api", apiVersion: "v1" }));

    app.get("/ready", {
      config: { rateLimit: false },
      schema: { operationId: "getReadiness", tags: ["Health"], summary: "Check trusted Account keys and rate-limit storage", response: {
        200: object({ status: { type: "string", enum: ["ready"] }, service: string }), 503: errorSchema,
      } },
    }, async () => {
      if (!redisReady()) throw new ApiError(503, "rate_limit_unavailable", "The rate-limit store is unavailable.");
      await identity.ready();
      return { status: "ready", service: "shot-api" };
    });

    const accountLinks = {
      signInUrl: `${config.account.webUrl}/signin`, signUpUrl: `${config.account.webUrl}/signin?mode=signup`,
      manageUrl: `${config.account.webUrl}/app/account`, securityManagedOnWeb: true,
    };
    const accountLinksSchema = object({ signInUrl: string, signUpUrl: string, manageUrl: string, securityManagedOnWeb: boolean });
    const offline = {
      licenseRequired: true, policyVersion: 1, maxAgeSeconds: config.offline.maxAgeSeconds,
      refreshAfterSeconds: config.offline.refreshAfterSeconds, audience: config.offline.audience,
      jwksUrl: `${config.account.apiBaseUrl}/v1/licenses/jwks.json`,
    };
    app.get("/api/v1/auth/config", {
      schema: { operationId: "getAuthConfig", tags: ["Account"], summary: "Get the native browser-login contract", response: {
        200: object({
          product: string, registrationRequired: boolean, issuer: string, discoveryUrl: string, clientId: string,
          resource: string, audience: string, scopes: { type: "array", items: string }, pkceMethod: string,
          redirect: object({ host: string, path: string, port: string }), account: accountLinksSchema, offline: offlinePolicySchema,
        }), 429: errorSchema,
      } },
    }, async () => ({
      product: SHOT_PRODUCT, registrationRequired: true, issuer: config.account.issuer,
      discoveryUrl: `${config.account.issuer}/.well-known/openid-configuration`, clientId: SHOT_CLIENT_ID,
      resource: "urn:algorithco:platform-api", audience: config.account.audience, scopes: SHOT_SCOPES, pkceMethod: "S256",
      redirect: { host: "127.0.0.1", path: "/callback", port: "ephemeral" }, account: accountLinks, offline,
    }));

    app.get("/api/v1/me", {
      preHandler: requireUser(identity),
      schema: { operationId: "getMyAccount", tags: ["Account"], summary: "Get the verified account and current app sign-in", security: bearerSecurity, response: {
        200: object({
          user: object({ id: string, issuer: string, email: string, emailVerified: boolean, name: nullableString, givenName: nullableString, familyName: nullableString }),
          session: object({ clientId: string, grantId: nullableString, authenticatedAt: nullableString, issuedAt: string, expiresAt: string }),
          account: accountLinksSchema, product: object({ id: string, registrationRequired: boolean }),
        }), ...protectedErrors,
      } },
    }, async (request) => {
      const user = currentUser(request);
      return {
        user: { id: user.sub, issuer: config.account.issuer, email: user.email, emailVerified: true, name: user.name, givenName: user.givenName, familyName: user.familyName },
        session: {
          clientId: user.clientId, grantId: user.grantId,
          authenticatedAt: user.authTime === null ? null : new Date(user.authTime * 1000).toISOString(),
          issuedAt: new Date(user.issuedAt * 1000).toISOString(), expiresAt: new Date(user.expiresAt * 1000).toISOString(),
        },
        account: accountLinks, product: { id: SHOT_PRODUCT, registrationRequired: true },
      };
    });

    app.get("/api/v1/me/entitlements", {
      preHandler: requireUser(identity, "entitlements:read"),
      schema: { operationId: "getMyEntitlements", tags: ["Access"], summary: "Get the current user's Shot Free entitlement", security: bearerSecurity,
        response: { 200: object({ entitlements: { type: "array", items: entitlementSchema } }), ...protectedErrors } },
    }, async (request) => ({ entitlements: [await account.entitlement(currentUser(request))] }));

    app.get("/api/v1/me/access", {
      preHandler: requireUser(identity, "entitlements:read"),
      schema: { operationId: "getMyAccess", tags: ["Access"], summary: "Check current Shot access and offline policy", security: bearerSecurity, response: {
        200: object({ product: string, plan: string, status: string, features: { type: "array", items: string }, limits,
          entitlementValidUntil: nullableString, checkedAt: string, offline: offlinePolicySchema }), ...protectedErrors,
      } },
    }, async (request) => {
      const entitlement = await account.entitlement(currentUser(request));
      return { product: SHOT_PRODUCT, plan: entitlement.plan, status: entitlement.status, features: SHOT_FEATURES, limits: entitlement.limits,
        entitlementValidUntil: entitlement.validUntil, checkedAt: new Date().toISOString(), offline };
    });

    // This supplements, rather than replaces, the global IP limit.
    const licenseLimit = app.createRateLimit({
      max: config.licenseRateLimitMax, timeWindow: 60000,
      keyGenerator: (request) => `license:${createHash("sha256").update(`${config.account.issuer}\0${currentUser(request).sub}`).digest("hex")}`,
    });
    app.post<{ Body: { deviceId: string } }>("/api/v1/me/offline-license", {
      preHandler: [requireUser(identity, ["license:issue", "entitlements:read"]), async (request) => {
        const result = await licenseLimit(request);
        if (!result.isAllowed && result.isExceeded) throw new ApiError(429, "rate_limited", "Too many license requests. Try again later.", result.ttlInSeconds);
      }],
      schema: {
        operationId: "issueMyOfflineLicense", tags: ["Access"], summary: "Obtain a verified, device-bound Shot offline license", security: bearerSecurity,
        body: object({ deviceId: { type: "string", minLength: 36, maxLength: 36, pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$" } }),
        response: { 200: object({ license: string, expiresAt: string, product: string, plan: string, deviceId: string, refreshAfterSeconds: integer }), ...protectedErrors },
      },
    }, async (request) => account.offlineLicense(currentUser(request), request.body.deviceId));
  };
}
