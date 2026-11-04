import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["dist/server.js"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: { ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(port), LOG_LEVEL: "silent", DOCS_ENABLED: "false", REDIS_URL: "", TRUST_PROXY: "0", ACCOUNT_ISSUER: `${origin}/account`, ACCOUNT_API_BASE_URL: origin, ACCOUNT_WEB_URL: origin },
  stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let diagnostics = "";
child.stdout.on("data", (chunk) => { diagnostics = (diagnostics + chunk).slice(-4000); });
child.stderr.on("data", (chunk) => { diagnostics = (diagnostics + chunk).slice(-4000); });
const exited = once(child, "exit");
try {
  let healthy = false;
  for (let attempt = 0; attempt < 300; attempt++) {
    if (child.exitCode !== null) throw new Error(`Built server exited: ${diagnostics}`);
    try { healthy = (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
    if (healthy) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(healthy, `Built server did not become live: ${diagnostics}`);
  const config = await fetch(`${origin}/api/v1/auth/config`).then((response) => response.json());
  assert.equal(config.registrationRequired, true);
  assert.equal(config.clientId, "shot-desktop");
  assert.equal((await fetch(`${origin}/api/v1/me`)).status, 401);
  assert.equal((await fetch(`${origin}/docs/`)).status, 404);
  console.log("Built Shot API smoke passed: liveness, native config, mandatory auth and disabled docs.");
} finally {
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
  try { await exited; } finally { clearTimeout(timer); }
}
