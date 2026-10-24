import { buildApp } from "./app.ts";
import { readConfig } from "./config.ts";

async function main() {
  const config = readConfig();
  const app = buildApp(config);
  let closing = false;

  async function shutdown(signal: NodeJS.Signals) {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, "Shutting down shot-api");
    try {
      await app.close();
    } catch (error) {
      app.log.error(error, "Could not close shot-api");
      process.exitCode = 1;
    }
  }

  process.once("SIGINT", () => { void shutdown("SIGINT"); });
  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });

  try {
    const address = await app.listen({ host: config.host, port: config.port });
    app.log.info({ url: new URL("/docs/", address).href }, "Swagger UI available");
  } catch (error) {
    app.log.error(error, "Could not start shot-api");
    await app.close();
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
