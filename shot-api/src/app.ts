import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { LogController } from "fastify";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import type { Writable } from "node:stream";
import { readConfig, type ApiConfig } from "./config.ts";
import { apiRoutes } from "./routes.ts";
import { AccountHttp } from "./account/http.ts";
import { AccountIdentity } from "./auth/identity.ts";
import { AccountClient } from "./account/client.ts";
import { ApiError, registerErrors } from "./errors.ts";

// Creating the application does not open a port, so tests can inject HTTP requests.
export function buildApp(config: ApiConfig = readConfig(), options: { fetcher?: typeof fetch; loggerStream?: Writable } = {}) {
  const proxyHops = config.trustProxy;
  const app = Fastify({
    genReqId: () => randomUUID(), requestIdHeader: false, logController: new LogController({ disableRequestLogging: true }),
    trustProxy: proxyHops === false ? false : (_address, hop) => hop < proxyHops,
    logger: {
      level: config.logLevel,
      ...(options.loggerStream ? { stream: options.loggerStream } : {}),
      redact: ["req.headers.authorization", "req.headers.cookie", "req.body", "req.url", "res.headers.set-cookie", "accessToken", "refreshToken", "license"],
    },
    bodyLimit: 16 * 1024, requestTimeout: 30_000, connectionTimeout: 10_000,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } },
  });
  registerErrors(app);
  app.decorateRequest("auth", null);
  app.addHook("onRequest", async (request, reply) => { reply.header("X-Request-Id", request.id); });
  app.addHook("onSend", async (_request, reply, payload) => {
    if (!reply.hasHeader("Cache-Control")) reply.header("Cache-Control", "no-store");
    const vary = new Set(String(reply.getHeader("Vary") ?? "").split(",").map((value) => value.trim()).filter(Boolean));
    vary.add("Origin"); vary.add("Authorization");
    reply.header("Vary", [...vary].join(", "));
    return payload;
  });
  app.addHook("onResponse", async (request, reply) => {
    request.log.info({ requestId: request.id, method: request.method, route: request.routeOptions.url ?? "unmatched", statusCode: reply.statusCode, durationMs: reply.elapsedTime }, "Request completed");
  });
  const http = new AccountHttp(config.account.timeoutMs, options.fetcher);
  const identity = new AccountIdentity(config, http);
  const account = new AccountClient(config, http, identity);
  const redis = config.redisUrl ? new Redis(config.redisUrl, {
    lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1,
    connectTimeout: 2000, commandTimeout: 2000, retryStrategy: (attempt) => Math.min(attempt * 200, 3000),
  }) : undefined;
  redis?.on("error", () => { app.log.warn({ category: "rate_limit_store" }, "Redis connection unavailable"); });
  app.addHook("onClose", async () => { redis?.disconnect(); });
  app.register(cors, { origin: config.corsOrigins, credentials: false, methods: ["GET", "POST", "OPTIONS"], exposedHeaders: ["X-Request-Id", "Retry-After"] });
  app.register(helmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, frameguard: { action: "deny" }, referrerPolicy: { policy: "no-referrer" }, hsts: config.nodeEnv === "production" ? { maxAge: 31536000 } : false });
  app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "AlgorithShot API",
        description: "Explore and test the AlgorithShot backend endpoints.",
        version: "0.1.0",
      },
      servers: [{ url: "/", description: "Current API server" }],
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Algorithco ES256 access token for shot-desktop with shot:access" } } },
      tags: [
        { name: "Health", description: "Service availability" },
        { name: "Service", description: "API information" },
        { name: "Account", description: "Native login configuration and verified account" },
        { name: "Access", description: "Shot Free access and device-bound offline licenses" },
      ],
    },
  });
  if (config.docsEnabled) app.register(swaggerUi, {
    routePrefix: "/docs",
    theme: { title: "AlgorithShot API — Swagger UI" },
    staticCSP: true,
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      filter: true,
      displayRequestDuration: true,
      validatorUrl: null,
    },
  });

  // Load routes after Swagger's onRoute hook so every API schema is discovered.
  app.register(async (scope) => {
    if (redis) await redis.connect();
    await scope.register(rateLimit, { global: true, max: config.rateLimitMax, timeWindow: 60000, cache: 5000, nameSpace: config.rateLimitNamespace, skipOnError: false, ...(redis ? { redis } : {}) });
    scope.addHook("onRequest", async (request) => {
      if (request.routeOptions.config.rateLimit !== false && redis && redis.status !== "ready") {
        throw new ApiError(503, "rate_limit_unavailable", "The rate-limit store is unavailable.");
      }
    });
    await scope.register(apiRoutes(config, identity, account, () => !redis || redis.status === "ready"));
  });

  return app;
}
