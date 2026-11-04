import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { accountFixture } from "./support/account.ts";

test("the central handoff manifest matches the public native authentication contract", async (t) => {
  const manifest = JSON.parse(await readFile(new URL("../integration/algorithco-shot.json", import.meta.url), "utf8"));
  const fixture = await accountFixture();
  t.after(() => fixture.app.close());
  const response = await fixture.app.inject({ url: "/api/v1/auth/config" });
  const config = response.json();
  assert.equal(manifest.product.key, config.product);
  assert.equal(manifest.product.plans[0].purchasable, false);
  assert.equal(manifest.oidcClient.client_id, config.clientId);
  assert.equal(manifest.oidcClient.token_endpoint_auth_method, "none");
  assert.equal(manifest.oidcClient.client_secret, undefined);
  assert.deepEqual(manifest.authorization.requestedScopes, config.scopes);
  assert.equal(manifest.authorization.audience, config.audience);
  assert.equal(manifest.offline.maxAgeSeconds, config.offline.maxAgeSeconds);
  assert.equal(manifest.offline.licenseAudience, config.offline.audience);
});
