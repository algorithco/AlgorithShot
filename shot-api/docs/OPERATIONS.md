# Shot API operations

## Local verification

Use Node 24.13+ and the repository's pinned pnpm. From the repository root:

```powershell
pnpm --dir shot-api typecheck
pnpm --dir shot-api test
pnpm api:build
pnpm --dir shot-api smoke
```

The built-server smoke test uses a temporary localhost port, verifies public health/config, protected-route denial and disabled documentation, then stops its child process. It does not contact central Account.

Redis tests require `TEST_REDIS_URL`; `pnpm --dir shot-api test:redis` verifies shared IP and user limits across independent processes' application instances. They use unique key prefixes, never `FLUSHDB`/`FLUSHALL`.

## Production configuration

Copy `.env.example` to the git-ignored `shot-api/.env`, then configure the real canonical Account URLs, production environment and Redis credentials. For production:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
DOCS_ENABLED=false
TRUST_PROXY=0
CORS_ORIGINS=
ACCOUNT_ISSUER=https://<account-host>/account
ACCOUNT_API_BASE_URL=https://<account-host>
ACCOUNT_WEB_URL=https://<company-web-host>
ACCOUNT_AUDIENCE=algorithco-platform-api
ACCOUNT_CLIENT_IDS=shot-desktop
REDIS_URL=redis://:<encoded-random-password>@redis:6379/0
SHOT_REDIS_PASSWORD=<same-random-password>
RATE_LIMIT_NAMESPACE=shot-api:production:
```

The values above contain placeholders and must be replaced. Use a URL-safe random password or percent-encode it in `REDIS_URL`. The Compose Redis service uses `SHOT_REDIS_PASSWORD`; the API URL must refer to the same password. For a managed Redis service, use its own address and TLS (`rediss://`) and run the API image independently of the bundled Redis service.

`TRUST_PROXY=0` deliberately ignores forwarded headers. Configure the exact hop count for your real trusted reverse-proxy path; do not trust arbitrary public clients. Keep the API's direct listener inaccessible to the public internet. The provided Compose mapping binds only to host loopback for an external HTTPS proxy/tunnel.

Production CORS defaults to empty. Native Rust HTTP requires no CORS permission. If a browser client needs access, list its exact HTTPS origin; Tauri's `tauri://localhost` and `http://tauri.localhost` are supported explicitly. Do not carry development Vite HTTP origins into production.

## Container

Build from the **repository root** so the existing frozen workspace lockfile is used:

```powershell
docker build -f shot-api/infra/Dockerfile -t algorithshot-api:local .
docker compose --env-file shot-api/.env -f shot-api/infra/compose.yaml config --quiet
docker compose --env-file shot-api/.env -f shot-api/infra/compose.yaml up -d --build
```

The Dockerfile-specific allowlist excludes desktop sources, `.git`, local env files, screenshots, node_modules and signing material from the build context. The runtime contains compiled JS and production dependencies, runs as the `node` user, and uses a read-only filesystem/capability restrictions in Compose. Release images should use the tested, immutable image digest in deployment.

The included Redis has persistence, a required password and no published port. Use dedicated databases/prefixes between staging and production. No Account database access or JWT signing keys are required by Shot API.

The container health check uses `/health`. Route traffic only after `/ready` succeeds. Readiness checks OIDC/license public trust data and the Redis connection; cached public keys remain valid for the bounded cache TTL. It is not a proof that `shot-desktop` is registered: use the Account acceptance procedure as well.

After building `algorithshot-api:local`, run `pnpm --dir shot-api smoke:container`. The smoke command creates a private internal test network and disposable Redis/API containers, verifies non-root/read-only runtime, mandatory auth, omitted development dependencies and safe readiness failure while Account is absent, then removes its test resources. It publishes no ports and does not contact the central Account. Set `SHOT_TEST_IMAGE` to test another local image tag.

## Central Account setup and smoke

Follow [ACCOUNT-SETUP.md](ACCOUNT-SETUP.md). With the correct local environment, run:

```powershell
pnpm --dir shot-api account:check
```

The command reads public discovery/JWKS and fails if required Shot scopes are absent. For an authenticated entitlement check, set a short-lived token in `ACCOUNT_CHECK_ACCESS_TOKEN` using your secure shell/session, then run it again. Never paste live tokens into issue reports, command arguments or committed fixtures. Native client approval still needs an interactive PKCE test. The checker does not create a license or modify central configuration.

## Monitoring

Track HTTP latency/error rates, `account_service_unavailable`, `account_contract_mismatch`, `invalid_offline_license`, `reauthentication_required`, `rate_limit_unavailable`, 429 rates and readiness failures. Join client reports to server logs using `X-Request-Id`. Never enable unrestricted request/body logging to diagnose auth incidents.

Expected states while Account setup is pending: `/health` 200; public `/api/v1/auth/config` available; `/ready` may be 503; unauthenticated `/me` 401. Do not add an anonymous fallback to make deployment checks green.

`/me` is an authenticated token/profile snapshot. `/me/access` and license issuance consult current Account entitlement. A stale or denied entitlement is never promoted to active Free access. Upstream HTTP failures, non-JSON bodies, oversized responses and redirects produce safe errors without returning upstream secrets.

## Rotation, outages and rollback

Account owns signing-key rotation. Publish new OIDC/license public keys before signing with them and retain previous keys through the applicable token/license window. The two key sets remain separate. The API refreshes unknown `kid` at a bounded rate; after trust-cache expiry, failed refresh is closed rather than accepting unchecked tokens.

During Account outage, valid token/profile reads may continue with cached public keys, but live entitlement and new-license operations can return 503. Desktop may retain only an already valid signed offline license until its original expiry. Definite authentication rejection is not treated as temporary network failure.

Deploy immutable versioned image tags/digests. This service currently has no product database migrations. Roll back by restoring the prior authenticated image/config and restarting the API; keep Account issuer/client/scope and public-key compatibility through the rollout window. A prior unauthenticated build is not a safe login-policy rollback. Stop rollout if fresh PKCE login, refresh rotation, entitlement, license binding or native access-gate acceptance fails.

SIGTERM/SIGINT close the HTTP service and Redis connection. Compose grants 15 seconds. Persistent screenshots and the desktop library are outside this container and are never touched by server shutdown or rollback.
