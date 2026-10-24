import type { FastifyPluginAsync } from "fastify";

export const apiRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { schema: { hide: true } }, async (_request, reply) => {
    return reply.redirect("/docs/");
  });

  app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());

  app.get("/health", {
    schema: {
      operationId: "getHealth",
      tags: ["Health"],
      summary: "Check API health",
      description: "Reports whether the HTTP service is running. No database is configured yet.",
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
};
