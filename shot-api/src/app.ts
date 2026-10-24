import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { readConfig, type ApiConfig } from "./config.ts";
import { apiRoutes } from "./routes.ts";

// Creating the application does not open a port, so tests can inject HTTP requests.
export function buildApp(config: ApiConfig = readConfig()) {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    bodyLimit: 1024 * 1024,
    requestTimeout: 15_000,
  });

  app.register(cors, { origin: config.corsOrigins });
  app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "AlgorithShot API",
        description: "Explore and test the AlgorithShot backend endpoints.",
        version: "0.1.0",
      },
      servers: [{ url: "/", description: "Current API server" }],
      tags: [
        { name: "Health", description: "Service availability" },
        { name: "Service", description: "API information" },
      ],
    },
  });
  app.register(swaggerUi, {
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
  app.register(apiRoutes);

  return app;
}
