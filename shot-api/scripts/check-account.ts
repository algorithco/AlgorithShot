import { readConfig, SHOT_SCOPES } from "../src/config.ts";
import { AccountHttp, record } from "../src/account/http.ts";
import { AccountIdentity } from "../src/auth/identity.ts";
import { AccountClient } from "../src/account/client.ts";
import { ApiError } from "../src/errors.ts";

try {
  const config = readConfig();
  const http = new AccountHttp(config.account.timeoutMs);
  const identity = new AccountIdentity(config, http);
  await identity.ready();
  const { body } = await http.json(`${config.account.issuer}/.well-known/openid-configuration`);
  const scopes = record(body) && Array.isArray(body.scopes_supported) ? body.scopes_supported : [];
  if (SHOT_SCOPES.some((scope) => !scopes.includes(scope))) {
    throw new ApiError(503, "missing_shot_scopes", "Account discovery does not advertise all requested Shot scopes.");
  }
  let entitlement = "not_checked";
  if (process.env.ACCOUNT_CHECK_ACCESS_TOKEN) {
    const user = await identity.accessToken(process.env.ACCOUNT_CHECK_ACCESS_TOKEN);
    await new AccountClient(config, http, identity).entitlement(user);
    entitlement = "verified";
  }
  // Never print supplied tokens, user profile data, keys, or upstream error bodies.
  console.log(JSON.stringify({ status: "ok", issuer: config.account.issuer, oidcKeys: "verified", licenseKeys: "verified", scopes: "verified", entitlement, clientRegistration: "Confirm with an interactive shot-desktop browser login." }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", code: error instanceof ApiError ? error.code : "configuration_error", message: error instanceof ApiError ? error.message : "Check the Account environment configuration." }, null, 2));
  process.exitCode = 1;
}
