<p align="center">
  <img src="desktop/src-tauri/icons/logo.svg" width="112" height="112" alt="AlgorithShot logo">
</p>

<h1 align="center">AlgorithShot</h1>

<p align="center">
  A Windows screenshot app that captures exactly what you need, finds it again by
  the text inside it, and hides private data before you share it.<br>
  Offline, in English, Uzbek and Russian.
</p>

<p align="center">
  <a href="https://github.com/algorithco/algorith-shot/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/algorithco/algorith-shot?label=release&labelColor=111111&color=ffd300"></a>
  <a href="https://github.com/algorithco/algorith-shot/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/algorithco/algorith-shot/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <img alt="Platform: Windows x64" src="https://img.shields.io/badge/platform-Windows%20x64-111111">
  <a href="LICENSE"><img alt="License: all rights reserved" src="https://img.shields.io/badge/license-all%20rights%20reserved-111111"></a>
</p>

<p align="center">
  <a href="https://github.com/algorithco/algorith-shot/releases/latest"><b>Download</b></a> ·
  <a href="desktop/README.md">Desktop guide</a> ·
  <a href="shot-api/README.md">API</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="SECURITY.md">Security</a>
</p>

## Features

- **Capture exactly:** one hotkey freezes the screen. Drag a region, click a
  window, capture the full screen or a fixed size, or use a timer. Hold Ctrl to
  adjust the capture with its size in real pixels.
- **Screen tools:** copy text from anything on screen with Windows OCR, scan QR
  codes and barcodes, pick colours, measure with the ruler, and pin a capture
  on top of other windows.
- **Edit and protect:** crop, annotate, blur or pixelate. A privacy check hides
  emails, phone numbers, cards, IDs, keys and faces in one go.
- **Find it again:** the library searches the text inside screenshots, the app,
  the window title or website, and the date. Latin and Cyrillic both match.
- **Private by design:** everything works offline, and nothing is uploaded.
  Screenshots are saved to `Pictures\AlgorithShot`.
- **Signed updates:** the app tells you when a new version is out and installs
  it when you click **Update now**.

## Download

Download `AlgorithShot_<version>_x64-setup.exe` from the
[latest release](https://github.com/algorithco/algorith-shot/releases/latest)
and run it. The [Releases](https://github.com/algorithco/algorith-shot/releases)
page has notes for every version.

## Repository

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
  .github/              CI, issue and pull request templates, code owners
  pnpm-workspace.yaml   Workspace packages
  pnpm-lock.yaml        Shared dependency lockfile
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

## Documentation

- [Desktop guide](desktop/README.md): features, local storage and the code layout
- [In-app updates and releases](desktop/docs/UPDATES.md): signing and publishing a version
- [Product plan](desktop/docs/PLAN.md): what the app is for and why
- [API guide](shot-api/README.md): endpoints, configuration and language tradeoffs

## Contributing

AlgorithShot is developed by Algorithco. Read [CONTRIBUTING.md](CONTRIBUTING.md)
before you open a pull request, and follow the [code of conduct](CODE_OF_CONDUCT.md).
For help, see [SUPPORT.md](SUPPORT.md).

Report security problems privately, as described in [SECURITY.md](SECURITY.md).
Do not open public issues for them.

## License

Not open source: all rights reserved. See [LICENSE](LICENSE). Send permission
requests to hello@algorithco.com.
