# Third-party notices

The [MIT License](LICENSE) covers code authored for AlgorithShot. Dependencies
and adapted upstream code keep their own copyright notices and license terms.
Changing this project's license does not relicense that material.

## Adapted code included in this repository

The Windows NSIS installer template in
[`desktop/src-tauri/windows/installer.nsi`](desktop/src-tauri/windows/installer.nsi)
is derived from Tauri's installer at upstream commit
`c464ef928c35d7eedd64bcd5df16b62b3393b7fa`.
Its MIT copyright and permission notice is preserved in
[`TAURI-LICENSE-MIT`](desktop/src-tauri/windows/TAURI-LICENSE-MIT).
Algorithco's modifications are identified in the template header.

The [code of conduct](CODE_OF_CONDUCT.md) is adapted from Contributor Covenant
2.1 and retains its attribution.

## Package dependencies

Exact JavaScript and Rust versions are recorded in `pnpm-lock.yaml` and
`desktop/src-tauri/Cargo.lock`. Their package manifests and accompanying
LICENSE, COPYING and NOTICE files are the sources of their license terms.
This includes transitive dependencies and native libraries bundled by crates.

The UI uses React, Tauri's JavaScript APIs, Zustand, TanStack Virtual and
Lucide icons. The native app uses Tauri, the Windows Rust bindings, SQLite,
image-processing libraries and rxing. The API uses Fastify and its plugins.
See the package manifests for the complete direct dependency lists.

Some Rust dependencies are licensed under MPL-2.0, including components used
by Tauri's HTML/CSS processing. Their source and license obligations remain
separate from AlgorithShot's MIT code. Preserve the applicable notices and
make the corresponding covered source available when distributing affected
binaries; review any changes to those dependencies before a release.

Maintainers must review added dependencies, retain upstream notices for
copied code, and include applicable license and NOTICE texts with redistributed
binaries. The [maintainer guide](docs/MAINTAINING.md) describes the release
review. A package's absence from this short overview does not remove its
license requirements.

## Windows components

Windows OCR, system fonts and UI Automation are provided by Windows. WebView2
is provided by Microsoft; the installer may download Microsoft's runtime.
Those components are governed by their suppliers' terms. AlgorithShot's MIT
license does not cover Windows or WebView2.
