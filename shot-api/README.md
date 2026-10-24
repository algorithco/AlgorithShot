# Shot API

The independent AlgorithShot backend, using TypeScript, Node.js and Fastify.
This initial service provides health and API information endpoints. Accounts,
authentication, a server database, screenshot uploads and synchronization need
separate product requirements and are not implemented in this foundation.

## Run

Use Node 24.13+ and pnpm 10.29.3. Install dependencies once from the repository
root with `pnpm install --frozen-lockfile`, then run `pnpm api:dev`.

To customize the API, copy `.env.example` to `.env` inside `shot-api/` and edit
the values. The development and production commands read this file when present;
existing environment variables take precedence. `.env` is ignored by Git.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Local listener; use `0.0.0.0` when deploying behind a proxy/container |
| `PORT` | `3000` | HTTP port, from 1 to 65535 |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` |
| `CORS_ORIGINS` | Local Vite and Tauri origins in `.env.example` | Comma-separated exact browser origins; an empty value disables cross-origin permission |

```bash
# From the repository root:
pnpm api:dev
pnpm api:build
pnpm api:start

# Or from shot-api/:
pnpm typecheck
pnpm test
```

Development uses Node's built-in TypeScript support and watch mode. Production
compiles to `dist/` and runs JavaScript. `SIGINT` and `SIGTERM` close the server
gracefully. Invalid port and logging settings fail before opening the listener.

## Swagger UI

After starting the API, open [Swagger UI](http://localhost:3000/docs/). Opening
[the API root](http://localhost:3000/) redirects there too. Expand an endpoint,
click **Try it out**, then **Execute** to send a request and inspect the real
HTTP response. The UI uses the server you opened, so it also works with a custom
port without changing the documentation configuration.

OpenAPI is generated from the route schemas. New API routes registered in
`src/routes.ts` appear automatically. Swagger UI's JavaScript and CSS are served
locally with the API.

- [OpenAPI JSON](http://localhost:3000/openapi.json) (also at `/docs/json`)
- [OpenAPI YAML](http://localhost:3000/docs/yaml)

## Endpoints

| Method | Path | Response |
| --- | --- | --- |
| GET | `/health` | `{"status":"ok","service":"shot-api"}` |
| GET | `/api/v1` | `{"service":"shot-api","apiVersion":"v1"}` |

The health endpoint reports the HTTP process only; no database is configured yet.
Endpoints are public. CORS controls which browser origins can read responses;
it is not authentication or authorization.

The desktop currently runs independently of this service. Its screenshot capture,
OCR and local library remain in `desktop/src-tauri/`. No upload or API request is
added to desktop startup by this change. Connecting a deployed API will also need
an explicit desktop API URL and a matching Tauri CSP `connect-src` entry.

## Backend language options

The selected stack is TypeScript + Fastify, matching the desktop UI language.
The tradeoffs below are project-specific engineering judgments.

| Option | Fit for this project | Tradeoff |
| --- | --- | --- |
| **TypeScript + Fastify (selected)** | Quick API iteration using the existing Node/pnpm toolchain; request/response types can later be shared with the UI | Needs a Node runtime; CPU-heavy image work should be handled outside the request event loop |
| **Go + net/http** | An independent HTTP service distributed as a compiled executable | Adds another language/toolchain; UI contracts need generation or separate definitions |
| **Rust + Axum** | Uses the same language as the Tauri native core; useful for shared Rust processing code | More involved async/ownership work and slower iteration than the selected stack for this initial API |

See the official [Fastify TypeScript guide](https://fastify.dev/docs/latest/Reference/TypeScript/),
[Go HTTP package](https://pkg.go.dev/net/http),
[Axum documentation](https://docs.rs/axum/latest/axum/), and
[Node TypeScript support](https://nodejs.org/docs/latest-v24.x/api/typescript.html).
