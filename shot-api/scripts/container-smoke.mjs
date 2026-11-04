import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const prefix = `shot-api-smoke-${randomUUID().slice(0, 8)}`;
const image = process.env.SHOT_TEST_IMAGE || "algorithshot-api:local";
const resources = [];
let networkCreated = false;

async function docker(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { errors = (errors + String(chunk)).slice(-4000); });
    child.on("error", reject);
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Docker ${args[0]} timed out.`)); }, 60000);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(output.trim());
      else reject(new Error(`Docker ${args[0]} failed: ${errors}`));
    });
  });
}

async function container(args) {
  const id = await docker(["run", "--rm", "--detach", "--label", `com.algorithco.shot-smoke=${prefix}`, ...args]);
  assert.match(id, /^[a-f0-9]{64}$/);
  resources.push(id);
  return id;
}

try {
  await docker(["network", "create", "--internal", "--label", `com.algorithco.shot-smoke=${prefix}`, prefix]);
  networkCreated = true;
  const redis = await container(["--network", prefix, "--network-alias", "redis", "redis:8.2-alpine", "redis-server", "--appendonly", "no"]);
  let redisReady = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { redisReady = (await docker(["exec", redis, "redis-cli", "ping"])) === "PONG"; } catch {}
    if (redisReady) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(redisReady, "Test Redis did not start.");
  const api = await container([
    "--network", prefix, "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--init",
    "-e", "NODE_ENV=production", "-e", "DOCS_ENABLED=false", "-e", "LOG_LEVEL=silent", "-e", "TRUST_PROXY=0",
    "-e", "ACCOUNT_ISSUER=https://account.example.test/account", "-e", "ACCOUNT_API_BASE_URL=https://account.example.test",
    "-e", "ACCOUNT_WEB_URL=https://company.example.test", "-e", "REDIS_URL=redis://redis:6379/0", image,
  ]);
  const checks = `
    const assert = (await import('node:assert/strict')).default;
    const fs = await import('node:fs');
    assert.notEqual(process.getuid(), 0);
    assert.ok(!fs.existsSync('src'));
    assert.ok(!fs.existsSync('.env'));
    try { import.meta.resolve('typescript'); assert.fail('Development compiler leaked into runtime'); }
    catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
    let healthy = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { healthy = (await fetch('http://127.0.0.1:3000/health')).ok; } catch {}
      if (healthy) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(healthy, 'Container did not become live');
    const config = await fetch('http://127.0.0.1:3000/api/v1/auth/config').then(r => r.json());
    assert.equal(config.registrationRequired, true);
    assert.equal(config.clientId, 'shot-desktop');
    assert.equal((await fetch('http://127.0.0.1:3000/api/v1/me')).status, 401);
    assert.equal((await fetch('http://127.0.0.1:3000/docs/')).status, 404);
    assert.equal((await fetch('http://127.0.0.1:3000/ready')).status, 503);
    assert.equal((await fetch('http://127.0.0.1:3000/health')).status, 200);
    console.log('Production container smoke passed: non-root/read-only, Redis, mandatory auth, no dev compiler/env, and fail-closed Account readiness.');
  `;
  console.log(await docker(["exec", api, "node", "--input-type=module", "-e", checks]));
} finally {
  const cleanupErrors = [];
  for (const id of resources.reverse()) {
    try { await docker(["rm", "--force", id]); } catch (error) { cleanupErrors.push(error.message); }
  }
  if (networkCreated) {
    try { await docker(["network", "rm", prefix]); } catch (error) { cleanupErrors.push(error.message); }
  }
  if (cleanupErrors.length) {
    console.error(`Test resource cleanup requires attention (${prefix}): ${cleanupErrors.join("; ")}`);
    process.exitCode = 1;
  }
}
