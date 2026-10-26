<p align="center">
  <img src="desktop/src-tauri/icons/logo.svg" width="112" height="112" alt="AlgorithShot logo">
</p>

<h1 align="center">AlgorithShot</h1>

<p align="center">
  A Windows screenshot app that captures exactly what you need, finds it again by
  the text inside it, and hides private data before you share it.<br>
  Open source, offline, in English, Uzbek and Russian.
</p>

<p align="center">
  <a href="https://github.com/algorithco/algorith-shot-releases/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/algorithco/algorith-shot-releases?label=release&labelColor=111111&color=ffd300"></a>
  <a href="https://github.com/algorithco/AlgorithShot/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/algorithco/AlgorithShot/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <img alt="Platform: Windows x64" src="https://img.shields.io/badge/platform-Windows%20x64-111111">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-111111"></a>
</p>

<p align="center">
  <a href="https://github.com/algorithco/algorith-shot-releases/releases/latest"><b>Download</b></a> ·
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
[latest release](https://github.com/algorithco/algorith-shot-releases/releases/latest)
and run it. The [Releases](https://github.com/algorithco/algorith-shot-releases/releases)
page has notes for every version. Installers and the update feed are published
in the public [algorith-shot-releases](https://github.com/algorithco/algorith-shot-releases)
repository. This repository contains the source code for the desktop app and API.

## Repository

AlgorithShot contains a Windows screenshot desktop app and a separate HTTP API.

```text
AlgorithShot/
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

Use Node 24.13+ and pnpm 10.29.3. The tested Node version is recorded in
`.node-version`; `rust-toolchain.toml` pins Rust 1.98.1. Native desktop builds
need Windows x64, the Rust MSVC toolchain, Visual Studio 2022 Build Tools with
**Desktop development with C++** and a Windows SDK, and WebView2 Runtime.
The browser UI and API can be developed on Windows, Linux or macOS with Node
and pnpm. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and testing details.

Clone the repository, then run the commands from its root:

```bash
git clone https://github.com/algorithco/AlgorithShot.git
cd AlgorithShot
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
pnpm desktop:build:local # Windows executable; no private signing key needed
pnpm release:build     # maintainer-only signed Windows installer
cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib
```

`pnpm build` builds the frontend and API. `pnpm desktop:build:local` builds a
standalone native executable under `desktop/src-tauri/target/local/release/`.
Use `pnpm desktop:build:local --debug` for a faster debug build. Local builds
disable update checks and create no installer or update feed. Official installers
use the separate [maintainer release process](desktop/docs/UPDATES.md).

## Documentation

- [Desktop guide](desktop/README.md): features, local storage and the code layout
- [In-app updates and releases](desktop/docs/UPDATES.md): signing and publishing a version
- [Product plan](desktop/docs/PLAN.md): what the app is for and why
- [API guide](shot-api/README.md): endpoints, configuration and language tradeoffs
- [Roadmap](ROADMAP.md): priorities and ways to help
- [Third-party notices](THIRD_PARTY_NOTICES.md): dependencies and upstream code
- [Maintainer guide](docs/MAINTAINING.md): reviews, security and releases

## Contributing

Contributions are welcome: bug reports, translations, documentation, tests and
code. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and
follow the [code of conduct](CODE_OF_CONDUCT.md). For help, see
[SUPPORT.md](SUPPORT.md).

Report security problems privately, as described in [SECURITY.md](SECURITY.md).
Do not open public issues for them.

## License

The desktop app and API are available under the [MIT License](LICENSE).
Dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
For use of the Algorithco and AlgorithShot names and logos, see
[BRANDING.md](BRANDING.md).
