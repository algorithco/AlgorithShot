# AlgorithShot

AlgorithShot contains a Windows screenshot desktop app and a separate HTTP API.

```text
algorithco-shot/
  desktop/              React + TypeScript UI and Tauri/Rust desktop app
    src/                Library, overlay, editor, quick card and pinned shots
    src-tauri/          Windows capture, OCR, SQLite library and installer
    dev/                Browser fixtures and installer development tools
    scripts/            Signed desktop release tooling
    docs/               Desktop product, setup and update documentation
  shot-api/             TypeScript + Fastify backend
    src/                Application, configuration and server entry point
    test/               HTTP and configuration tests
  .github/workflows/    Checks for both projects
  pnpm-workspace.yaml  Workspace packages
  pnpm-lock.yaml       Shared dependency lockfile
```

The desktop app captures, edits, indexes and searches screenshots locally. The API
runs as a separate process and can be deployed independently. Its initial endpoints
provide service information and health checks. Accounts, uploads and cloud sync
are not implemented yet; starting the API does not upload desktop screenshots.

## Development

Use Node 24.13+ and pnpm 10.29.3. Desktop builds also need Rust (MSVC) and the
Visual Studio C++ build tools on Windows. Backend development only needs Node
and pnpm.

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm desktop:dev       # Tauri desktop app
pnpm dev               # desktop pages in a browser, with local fake data
pnpm api:dev           # API on http://127.0.0.1:3000, with watch mode
```

Run the desktop and API in separate terminals when both are needed. Individual
package commands also work inside `desktop/` and `shot-api/`.

The API's [Swagger UI](http://localhost:3000/docs/) lists the endpoints, request
and response schemas, and lets you send requests with **Try it out**. The
[OpenAPI schema](http://localhost:3000/openapi.json) is available as JSON.

```bash
pnpm typecheck         # both projects
pnpm test              # desktop and API tests
pnpm test:release      # desktop release metadata checks
pnpm build             # desktop frontend and API production builds
pnpm api:start         # start the built API
pnpm release:build     # signed Windows desktop installer
cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib
```

`pnpm tauri dev` remains available from the repository root. `pnpm build` builds
the desktop frontend; a native Windows installer is built with `pnpm release:build`.

See [desktop documentation](desktop/README.md) for app features and local storage,
[update publishing](desktop/docs/UPDATES.md) for signed releases, and
[API documentation](shot-api/README.md) for endpoints, configuration and language
tradeoffs.

## License

Not open source: all rights reserved. See [LICENSE](LICENSE).
