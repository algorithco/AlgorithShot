import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { accountFixture, USER_ID } from "./support/account.ts";

test("Account setup checker verifies real HTTP trust data and optional entitlement without printing credentials", async (t) => {
  let fixture: Awaited<ReturnType<typeof accountFixture>>;
  const server = createServer((request, response) => {
    void (async () => {
      const remote = await fixture.fetcher(`${fixture.config.account.apiBaseUrl}${request.url}`, { redirect: "error", headers: request.headers as Record<string, string> });
      response.writeHead(remote.status, Object.fromEntries(remote.headers));
      response.end(Buffer.from(await remote.arrayBuffer()));
    })().catch(() => { response.writeHead(500); response.end(); });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  fixture = await accountFixture({ ACCOUNT_ISSUER: `${origin}/account`, ACCOUNT_API_BASE_URL: origin, ACCOUNT_WEB_URL: origin });
  t.after(() => fixture.app.close());
  const token = await fixture.token();
  async function runChecker() {
    const child = spawn(process.execPath, ["scripts/check-account.ts"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)), windowsHide: true,
      env: { ...process.env, NODE_ENV: "test", ACCOUNT_ISSUER: `${origin}/account`, ACCOUNT_API_BASE_URL: origin, ACCOUNT_WEB_URL: origin, ACCOUNT_CLIENT_IDS: "shot-desktop", REDIS_URL: "", ACCOUNT_CHECK_ACCESS_TOKEN: token },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 15000);
    try {
      const [code] = await once(child, "exit");
      return { code, output };
    } finally { clearTimeout(timeout); }
  }
  const success = await runChecker();
  assert.equal(success.code, 0, success.output);
  assert.equal(JSON.parse(success.output).entitlement, "verified");
  for (const secret of [token, USER_ID, "person@example.test"]) assert.ok(!success.output.includes(secret));
  fixture.state.metadata = { scopes_supported: ["openid", "profile", "email"] };
  const rejected = await runChecker();
  assert.equal(rejected.code, 1, rejected.output);
  assert.equal(JSON.parse(rejected.output).code, "missing_shot_scopes");
});
