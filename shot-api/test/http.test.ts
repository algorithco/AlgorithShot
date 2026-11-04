import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { once } from "node:events";
import { AccountHttp } from "../src/account/http.ts";
import { ApiError } from "../src/errors.ts";

test("redirects never forward a user's bearer token", async (t) => {
  let redirected = false;
  const server = createServer((request, response) => {
    if (request.url === "/first") response.writeHead(302, { location: "/second" }).end();
    else { redirected = true; response.setHeader("content-type", "application/json"); response.end("{}"); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const http = new AccountHttp(1000);
  await assert.rejects(http.json(`http://127.0.0.1:${address.port}/first`, { headers: { Authorization: "Bearer fixture-token" } }), (error: unknown) => error instanceof ApiError && error.statusCode === 503);
  assert.equal(redirected, false);
});

test("streaming responses cannot bypass the JSON byte limit", async () => {
  const fetcher: typeof fetch = async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode("["));
    controller.enqueue(new Uint8Array(128));
    controller.close();
  } }), { headers: { "content-type": "application/json" } });
  await assert.rejects(new AccountHttp(1000, fetcher).json("https://account.example", {}, 64), (error: unknown) => error instanceof ApiError && error.code === "account_contract_mismatch");
});

test("a stalled upstream is aborted within the configured request deadline", async () => {
  const fetcher: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("deadline was not enforced")), 5000);
    init!.signal!.addEventListener("abort", () => { clearTimeout(timer); reject(init!.signal!.reason); }, { once: true });
  });
  const start = Date.now();
  await assert.rejects(new AccountHttp(100, fetcher).json("https://account.example"), (error: unknown) => error instanceof ApiError && error.statusCode === 503);
  assert.ok(Date.now() - start < 2000);
});

test("malformed JSON, wrong content types and oversized declared bodies fail closed", async () => {
  for (const response of [
    () => new Response("not-json", { headers: { "content-type": "application/json" } }),
    () => new Response("{}", { headers: { "content-type": "text/html" } }),
    () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "999999" } }),
    () => new Response("{}", { status: 401, headers: { "content-type": "application/json" } }),
  ]) {
    const fetcher: typeof fetch = async () => response();
    await assert.rejects(new AccountHttp(1000, fetcher).json("https://account.example"), (error: unknown) => error instanceof ApiError && error.statusCode === 503);
  }
});
