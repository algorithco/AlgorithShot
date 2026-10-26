# In-app updates

The main window checks for a newer version in parallel with startup. An available
release appears above every page with an **Update now / Yangilang / Обновить**
button. Clicking it downloads the signed NSIS installer, shows progress, verifies
its signature, then installs and restarts the app. Updates use the current-user,
passive installer, so no installation wizard is needed.

Checks repeat every 15 minutes, on returning to the app (at most once a minute),
and when the connection comes back. Offline checks do not block the app. Failed
downloads or installations leave a retry button. Checking never installs anything
without a click. Development builds do not contact the update endpoint.

Releases are published in the public
[algorithco/algorith-shot-releases](https://github.com/algorithco/algorith-shot-releases)
repository. That repository holds the installers and update feed; the desktop
and API source code are in `algorithco/AlgorithShot` under the MIT License.
The existing update feed remains:
`https://github.com/algorithco/algorith-shot-releases/releases/latest/download/latest.json`.
Both the manifest and installer assets must be publicly readable. The release
script builds the installer URLs from the updater endpoint in
`src-tauri/tauri.conf.json`.

Versions 0.1.0 and 0.1.1 check an older feed in the source repository. Those
versions may need a one-time manual installation of 0.1.2 or later to use the
current feed.

## Builds from source

Contributors need no private key. From the repository root, run
`pnpm desktop:build:local` or `pnpm desktop:build:local --debug`.
The executable is placed in `desktop/src-tauri/target/local/release/` or
`desktop/src-tauri/target/local/debug/`. The command verifies embedded assets
without opening the app or accessing user data.

Local builds disable frontend update checks, clear updater endpoints, disable
update artifact generation and remove inherited signing variables. They use a
separate Cargo target directory and create neither installers nor `latest.json`.
The configured public key is public configuration and can remain in the source.

The rest of this guide is for maintainers publishing official installers.

## Signing setup

The trusted public key is in `src-tauri/tauri.conf.json`. Keep the matching
private key and any password in maintainer-controlled secret storage and keep
a secure backup. Installed apps trust this public key, so changing the key
requires a migration plan.

`pnpm release:build` can read an existing maintainer key from
`desktop/.local/updater/algorithshot.key`, which Git ignores. Contributors do
not need or receive this file. Never commit a private key or put one in an issue,
artifact or workflow log.
If Rust runs out of memory while compiling, set `$env:CARGO_BUILD_JOBS = '1'`
before that command to reduce parallel compiler processes.

On another computer or in a build service, restore the same private key outside
Git and set the following in the current PowerShell session:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.tauri\algorithshot.key"
# Set TAURI_SIGNING_PRIVATE_KEY_PASSWORD from your secret store if required.
pnpm release:build
```

The build command
supplies the configured public key to the Rust compiler through
`TAURI_UPDATER_PUBLIC_KEY` and to Tauri's bundler using a config override.
It rejects an environment public key that differs from the one in the config.
Release builds refuse to compile without the public key, so an
installer with an unconfigured updater cannot accidentally be distributed.
Private keys are used only by Tauri's signing step and never embedded in the app.

## Prepare and publish a version

1. Set the same higher version in `package.json`, `src-tauri/Cargo.toml`, and
   `src-tauri/tauri.conf.json`. Refresh `src-tauri/Cargo.lock` with `cargo check`.
2. Run the checks below, set the signing variables, and run `pnpm release:build`.
3. The NSIS folder contains the versioned `.exe`, its `.sig`, and `latest.json`.
   Review them, then attach all three to a GitHub release in
   `algorithco/algorith-shot-releases` with the matching tag, for example
   `v0.2.0`. Tag the exact source commit in `algorithco/AlgorithShot` with the
   same tag, and link that source tag and the changelog in the release notes.
4. Publish it as a stable release. Installed older versions will then show the
   update banner. Drafts and prereleases do not become the `latest` feed.

The local build command prepares files only; it does not publish a release.
It validates version consistency and the feed repository, then compiles the app
and runs `algorithco-shot.exe --verify-assets` before bundling. This checks all
five embedded pages and decompresses every bundled asset without opening windows
or accessing user data. Missing or corrupt assets stop the release. The signature
file is checked before producing a manifest.

The Rust build recreates its generated asset cache when the frontend changes, so
damaged cached files cannot silently survive a rebuild. If an existing installer
shows `asset not found: index.html`, rebuild with `pnpm release:build` and install
the verified replacement; copying `dist` beside the installed executable does
not repair its embedded assets.

The first version containing the updater must be installed manually by existing
users. Versions without an updater cannot discover it on their own.

Development remains `pnpm tauri dev`; it needs no signing key.
In browser development, open
`http://localhost:1420/?update-preview=available&lang=uz` to try the banner and
simulated click/download/install flow. The preview also accepts `downloading`,
`installing`, `restarting`, and `error`. It never downloads or installs software.

## Verify

Run `pnpm test`, `pnpm test:release`, `pnpm build`, and
`cargo check --manifest-path src-tauri/Cargo.toml --locked`.

For a real installation check, install an older signed build, publish a newer
signed stable release with the same key, then open the older app and click the
banner. Verify progress, the installed version, automatic restart, and preserved
settings/library. Repeat after interrupting the download to exercise retry.

Tauri's updater validates a newer semantic version and verifies the installer
signature before installation. See the [official updater documentation](https://v2.tauri.app/plugin/updater/).
