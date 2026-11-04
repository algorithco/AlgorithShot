# Shot API

AlgorithShot's authenticated resource server, using Node 24.13+, TypeScript and Fastify. It integrates with the existing Algorithco Account service for web registration/login, verified profiles, Shot Free entitlements and signed offline licenses.

The backend implementation is ready for central Account registration and desktop integration. Central Account and desktop code are not changed by this package. Mandatory login for local screenshot commands also requires the native gate described in [NATIVE-INTEGRATION.md](docs/NATIVE-INTEGRATION.md).

## Run

From the repository root:

```powershell
pnpm install --frozen-lockfile
Copy-Item shot-api/.env.example shot-api/.env
pnpm api:dev
```

Edit the ignored `.env` for your environment. Existing process environment variables take precedence. The server defaults to `127.0.0.1:3000`.

Development can start before Account is configured. Public health/config endpoints work; protected endpoints still require genuine signed Shot tokens. There is no mock-login or anonymous bypass in the server. Tests generate independent fixture keys and mock only Account HTTP responses.

```powershell
pnpm --dir shot-api typecheck
pnpm --dir shot-api test
pnpm api:build
pnpm --dir shot-api smoke
pnpm api:start
```

The optional Redis integration tests use a dedicated test Redis URL:

```powershell
$env:TEST_REDIS_URL = 'redis://127.0.0.1:6379'
pnpm --dir shot-api test:redis
```

Tests use unique key namespaces and do not flush databases.

## Implemented endpoints

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/health` | Public process liveness |
| GET | `/ready` | OIDC/license public trust data and rate-limit store readiness |
| GET | `/api/v1` | Public service information |
| GET | `/api/v1/auth/config` | Public native client/issuer/scopes, account links and offline policy |
| GET | `/api/v1/me` | Verified profile snapshot and current native grant metadata |
| GET | `/api/v1/me/access` | Live Shot Free entitlement, capabilities and offline policy |
| GET | `/api/v1/me/entitlements` | Current user's Shot entitlement |
| POST | `/api/v1/me/offline-license` | Verified license for `{ "deviceId": "<uuid-v4>" }` |

All `/me` routes require an ES256 access token, exact issuer/audience, an allowed `client_id`, verified email and `shot:access`. Access/entitlement endpoints also require `entitlements:read`; license issuance requires both `entitlements:read` and `license:issue`.

The API accepts neither ID tokens nor offline licenses as Bearer API credentials. User and product are derived from the verified token and fixed Shot configuration, never a caller-supplied subject/product. Current Free capabilities are capture, OCR, editor, library, QR and pin.

The server calls central `/v1/entitlements` and `/v1/licenses` at the Account **host root**, independently of the issuer's `/account` path. It does not connect to the central database, store passwords/refresh tokens or create a competing identity system. Screenshot content is never uploaded.

## Account and offline policy

The Account screen combines `/me`, `/me/access` and the native cached license status. Profile, password, MFA, identities, other sessions and account deletion are managed on the existing company web Account center. Current central management routes use browser cookies/CSRF; the backend does not forge a desktop-compatible proxy for them.

Offline licenses come from Account, using a dedicated ES256 license key set. Shot verifies the signed subject, product, Free plan, device ID, lifetime and expiry before returning the token. The desktop must verify it natively as well.

The configurable default maximum is seven days with renewal recommended every 24 hours. A longer upstream license is rejected rather than shortened/re-signed. Expiry from the signed JWT is authoritative. Network failure cannot mint or extend offline access. A license POST is not automatically retried because central issuance is not idempotent.

Revocation is bounded by token/license lifetime. A valid access token may remain usable until its ten-minute expiry; an offline license may remain usable until `exp`. Immediate license-renewal revocation needs a central active-grant check. No claim of instant offline revocation is made.

## Configuration

All settings are documented in [.env.example](.env.example). Invalid configuration fails before the HTTP listener opens.

| Variable | Default / requirement |
| --- | --- |
| `NODE_ENV` | `development`; production activates strict requirements |
| `HOST`, `PORT`, `LOG_LEVEL` | `127.0.0.1`, `3000`, `info` |
| `TRUST_PROXY` | `0`; exact trusted hop count 0–10, explicitly required in production |
| `CORS_ORIGINS` | Local Vite/Tauri origins in development; empty in production unless configured |
| `DOCS_ENABLED` | True in development, false in production |
| `ACCOUNT_ISSUER` | Example `https://algorithco.trqsh.uz/account`; explicitly required in production |
| `ACCOUNT_API_BASE_URL` | Issuer origin; explicitly required in production, same trusted origin |
| `ACCOUNT_WEB_URL` | Company web origin; explicitly required in production |
| `ACCOUNT_AUDIENCE` | `algorithco-platform-api` |
| `ACCOUNT_CLIENT_IDS` | `shot-desktop`; explicit allowlist, must include native Shot |
| `ACCOUNT_TIMEOUT_MS` | 5000; aborts upstream requests and rejects redirects |
| `ACCOUNT_METADATA_CACHE_MS` | 600000; bounded discovery/public-key cache |
| `ACCOUNT_JWKS_COOLDOWN_MS` | 30000; bounds unknown-key refreshes |
| `ACCOUNT_CLOCK_TOLERANCE_SECONDS` | 5, maximum 30 |
| `LICENSE_AUDIENCE` | `algorithco-products` |
| `OFFLINE_MAX_AGE_SECONDS` | 604800; configurable 3600–2592000, must match central Shot policy |
| `OFFLINE_REFRESH_AFTER_SECONDS` | 86400 by default; never exceeds maximum lifetime |
| `REDIS_URL` | Optional locally; required in production; `redis://` or `rediss://` |
| `RATE_LIMIT_NAMESPACE` | `shot-api:rate:`; separate staging and production namespaces/databases |
| `RATE_LIMIT_MAX` | 120 requests/minute/IP |
| `LICENSE_RATE_LIMIT_MAX` | 5 requests/minute/verified user, across IPs |
| `SHOT_REDIS_PASSWORD`, `SHOT_API_PORT` | Compose deployment inputs, not API authentication credentials |

No private JWT signing keys or OIDC client secrets belong in Shot API. Production disallows insecure Account URLs. Native public clients have no secret.

## Errors and logs

Errors are `{ "error": { "code", "message", "requestId" } }`, with a server-generated `X-Request-Id`. Authentication failure is 401, insufficient access 403, invalid input 400, local limits 429 and upstream/trust failures 503. Honor `Retry-After` where supplied. There is no fallback from failed signature validation to unverified decoding.

Account responses are bounded, timeout-controlled and never follow redirects. Logs contain route patterns, status, timing and request IDs, not raw URLs, bodies, tokens, license JWTs or profile data. JSON responses are not shared-cacheable. Redis limits are shared by instances and do not fail open when the store fails.

`/ready` can use still-valid cached public trust data during an upstream outage. It verifies key availability, not unpublished client registration or the availability of future user tokens. `/health` remains independent of external dependencies.

## API documentation

In development open [Swagger UI](http://localhost:3000/docs/). Use **Authorize** with a fresh Shot access token. OpenAPI JSON is at `/openapi.json` or `/docs/json`, YAML at `/docs/yaml`. Assets are served locally. These endpoints return 404 when docs are disabled.

## Integration and deployment

- [Central Account setup (Uzbek)](docs/ACCOUNT-SETUP.md): exact client, scopes, Free product, license keys/policy and acceptance checks.
- [Machine-readable handoff](integration/algorithco-shot.json): matching configuration contract, not an auto-import file.
- [Native app integration](docs/NATIVE-INTEGRATION.md): browser PKCE, vault, account UI, logout, offline verification and native command gates.
- [Production operations](docs/OPERATIONS.md): Docker, Redis, TLS/proxy, diagnostics and rollback.
- [Original product plan and research](docs/PRODUCT-AUTH-PLAN.md): architecture decisions and source evidence.

After configuring Account, run `pnpm --dir shot-api account:check`. It checks discovery, required scopes and both public key sets. Optionally provide `ACCOUNT_CHECK_ACCESS_TOKEN` through the environment to verify a genuine token and entitlement. Tokens/profile data are not printed, and the checker creates no license. Native client registration still requires an interactive login test.

Build the container with `docker build -f shot-api/infra/Dockerfile -t algorithshot-api:local .`, then use `pnpm --dir shot-api smoke:container` for an isolated production-runtime smoke test. It cleans up its own disposable containers and network.

## License

MIT, as in the repository [LICENSE](../LICENSE). Dependencies retain their own licenses.
