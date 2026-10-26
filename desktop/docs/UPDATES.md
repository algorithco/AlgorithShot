# Desktop releases and updates

The desktop and API source, official installers and `latest.json` are all
published in [algorithco/AlgorithShot](https://github.com/algorithco/AlgorithShot),
under MIT. Each tagged release includes the complete installer, signature,
checksum and license artifact set built from that source commit.

The update feed is:
`https://github.com/algorithco/AlgorithShot/releases/latest/download/latest.json`.
Keep that URL and the trusted public key for future updates. Versions 0.1.2 and
0.2.0 embed the retired separate-repository URL, so their users must manually
install 0.2.1 or newer once. Versions 0.1.0 and 0.1.1 also need a manual upgrade.
Installing over an older version preserves screenshots and settings.

## Build from source

Contributors need no private keys. From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm desktop:build:local
pnpm desktop:build:local --debug
```

The executable is in `desktop/src-tauri/target/local/release/` or `debug/`:
`algorithco-shot.exe` on Windows, `algorithco-shot` on macOS/Linux. Local builds
use a separate Cargo target directory, disable updater endpoints and frontend
update checks, remove inherited signing credentials, and create no installers
or update feed. The command verifies all embedded pages without opening the app
or reading the user's screenshot library.

Native macOS/Linux builds include an offline OCR worker and four language models.
CI runs the compiled app with `--verify-ocr` to recognize an English, Russian and
Uzbek fixture through the actual native WebKit webview. Linux runs this check in
Xvfb with a temporary D-Bus session. See [CONTRIBUTING.md](../../CONTRIBUTING.md)
for prerequisites.

## Prepare official installers

The **Desktop release artifacts** workflow builds these packages from a source tag:

| Platform | Installers | Updater artifact |
| --- | --- | --- |
| Windows x64 | NSIS `.exe` | The same `.exe` |
| macOS Intel and Apple Silicon | Universal `.dmg` | Universal `.app.tar.gz` |
| Linux x86_64, X11 | `.AppImage`, `.deb`, `.rpm` | Each matching package |

The workflow has a read-only GitHub token and no updater private key. It uploads
unsigned updater artifacts for review; it cannot publish a release. macOS builds
use local/ad-hoc app signing unless a maintainer separately configures Apple signing
and notarization. Ad-hoc signing does not provide Developer ID notarization.

To build the current host's installers yourself, run `pnpm release:build`.
On macOS, `pnpm release:build --target universal-apple-darwin` also needs both
Rust target architectures installed. `pnpm release:build:unsigned` is an explicit
alias used by CI. Both commands preserve official update settings, validate the
version and feed, verify embedded assets, collect dependency license texts, and
use `desktop/src-tauri/target/release-build/`. macOS/Linux also verify native OCR.
On headless Linux, run the command through `xvfb-run -a dbus-run-session --`.
Outputs are under `desktop/.local/release/<version>/<platform>/`. The builder
also runs native verification from the packaged AppImage and macOS `.app`, and
checks both architectures in a universal Mac executable.

## Signing and publishing

1. Set the same new version in `desktop/package.json`, `desktop/src-tauri/Cargo.toml`
   and `desktop/src-tauri/tauri.conf.json`, and update `desktop/src-tauri/Cargo.lock`.
   Run the checks in [the maintainer guide](../../docs/MAINTAINING.md). All three
   native CI jobs must pass before publishing.
2. Commit and push the reviewed source, then tag that exact commit, for example
   `v0.2.1`. Pushing the tag starts the release artifact workflow.
3. When every platform build succeeds, check out that exact source commit and
   download all three artifact groups from that run:

   ```bash
   gh run download <run-id> --repo algorithco/AlgorithShot --dir .local/release-downloads/v0.2.1
   ```

4. Set `TAURI_SIGNING_PRIVATE_KEY_PATH` to the maintainer's existing private key
   file. Supply `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` through your secret store
   when the key is encrypted. A maintainer with an existing ignored
   `desktop/.local/updater/algorithshot.key` can use that local key directly.
   Never commit the key or put it in a workflow, artifact, issue or log.
5. Run the signing and verification command from the repository root:

   ```bash
   pnpm release:prepare .local/release-downloads/v0.2.1
   ```

   It requires all platform groups to identify the current source commit,
   version, feed repository and trusted public key. It signs updater artifacts
   locally with the app version in the trusted comment, then uses the
   `tools/verify-update/` verifier to check their signatures and signed versions
   against the configured public key. A wrong key, modified file, wrong version
   or missing platform stops preparation.
6. Review the resulting `desktop/.local/release/<version>/publish-*/` folder.
   It includes installers, five `.sig` files, build provenance for each OS,
   dependency license texts, `SHA256SUMS.txt` and one complete `latest.json`.
   Its updater entries cover Windows, AppImage, Debian, RPM and both Mac
   architectures. Both Mac entries use the universal app archive; Linux selects
   the package type already installed. Debian/RPM updates may request system
   authorization through Polkit or sudo.
7. Create a draft release with the matching tag in `algorithco/AlgorithShot`.
   Attach every prepared file, link the source tag, describe the changes and
   list platform requirements. Publish the stable release only when all files
   are present and reviewed. Verify the public download URLs and the update feed
   from that same repository before marking the release as latest.

Preparation does not publish anything or upload the private key. The verifier
also checks the signature over Minisign's trusted comment. The updater signature
is separate from Windows Authenticode and Apple Developer ID signing.

## Runtime behavior and validation

Official builds check in parallel with startup, every 15 minutes, when returning
from the background (at most once a minute), and when the connection comes back.
Offline checks do not block the app. An available version appears above the
current page. Downloads and installation begin only after **Update now** is clicked.
Failures leave a retry action. The updater verifies the artifact before installing
it, then restarts the app. Local standalone and development builds make no update
requests.

Before publishing a change to installation or storage, verify an upgrade from an
older signed build, interruption and retry, restart, and preserved screenshots,
settings and library. Test uninstall behavior on Windows. macOS capture requires
Screen Recording permission, and accessibility-based snapping requires Accessibility
permission. Full Linux capture and shortcut support requires an X11 session.

The browser update preview accepts `?update-preview=available&lang=uz` and the
states `downloading`, `installing`, `restarting`, and `error`. It never downloads
or installs software. See [Tauri's updater documentation](https://v2.tauri.app/plugin/updater/).
