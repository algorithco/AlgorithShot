import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.ts";
import { readConfig } from "../src/config.ts";

function createApp() {
  return buildApp(readConfig({ LOG_LEVEL: "silent" }));
}

test("the API root opens the interactive documentation", async (t) => {
  const app = createApp();
  t.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/" });
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, "/docs/");
});

test("Swagger UI and its local assets are available", async (t) => {
  const app = createApp();
  t.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/docs/" });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] ?? "", /text\/html/);
  assert.match(response.body, /AlgorithShot API/);
  assert.match(response.body, /swagger-ui-bundle\.js/);
  assert.ok(response.headers["content-security-policy"]);

  for (const asset of ["swagger-ui.css", "swagger-ui-bundle.js", "swagger-initializer.js"]) {
    const result = await app.inject({ method: "GET", url: `/docs/static/${asset}` });
    assert.equal(result.statusCode, 200, asset);
    assert.ok(result.body.length > 0, asset);
  }
});

test("OpenAPI discovers API schemas and uses the current server for Try it out", async (t) => {
  const app = createApp();
  t.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/docs/json" });
  assert.equal(response.statusCode, 200);
  const spec = response.json();
  assert.equal(spec.openapi, "3.0.3");
  assert.equal(spec.info.title, "AlgorithShot API");
  assert.equal(spec.servers[0].url, "/");
  assert.deepEqual(Object.keys(spec.paths).sort(), ["/api/v1", "/health"]);
  assert.equal(spec.paths["/health"].get.operationId, "getHealth");
  assert.ok(spec.paths["/health"].get.responses["200"].content["application/json"].schema);
  assert.equal(spec.paths["/api/v1"].get.operationId, "getServiceInfo");

  const alias = await app.inject({ method: "GET", url: "/openapi.json" });
  assert.equal(alias.statusCode, 200);
  assert.deepEqual(alias.json(), spec);
});

test("the documentation publishes a YAML schema too", async (t) => {
  const app = createApp();
  t.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/docs/yaml" });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /openapi: 3\.0\.3/);
  assert.match(response.body, /\/health:/);
});
