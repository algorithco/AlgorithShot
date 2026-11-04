import { buildApp } from "./app.ts";
import { readConfig } from "./config.ts";

async function main() {
  let config;
  try { config = readConfig(); }
  catch (error) {
    // Configuration errors name the field, never its value.
    console.error(error instanceof Error ? error.message : "Invalid Shot API configuration.");
    process.exitCode = 1;
    return;
  }
  const app = buildApp(config);
  let closing = false;

  async function shutdown(signal: NodeJS.Signals) {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, "Shutting down shot-api");
    try {
      await app.close();
    } catch {
      app.log.error({ category: "shutdown_failed" }, "Could not close shot-api");
      process.exitCode = 1;
    }
  }

  process.once("SIGINT", () => { void shutdown("SIGINT"); });
  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });

  try {
    const address = await app.listen({ host: config.host, port: config.port });
    if (config.docsEnabled) app.log.info({ url: new URL("/docs/", address).href }, "Swagger UI available");
  } catch {
    app.log.error({ category: "startup_failed" }, "Could not start shot-api");
    await app.close();
    process.exitCode = 1;
  }
}

main().catch(() => {
  console.error("Shot API startup failed. Check configuration and Redis connectivity.");
  process.exitCode = 1;
});
