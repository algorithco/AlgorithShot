# Contributing to AlgorithShot

AlgorithShot's desktop app and API are open source under the [MIT License](LICENSE).
Everyone is welcome to report bugs, improve documentation, translate the app,
write tests or contribute code. Look at the [roadmap](ROADMAP.md) for priorities.
Report security problems privately as described in [SECURITY.md](SECURITY.md).

By taking part, you agree to follow the [code of conduct](CODE_OF_CONDUCT.md).

## Bugs and ideas

- Search the [existing issues](https://github.com/algorithco/AlgorithShot/issues)
  first.
- Open a new issue with the **Bug report** or **Feature request** form.
- Include the version (shown in **Settings › About**), your Windows version, your
  monitors and scaling, and the steps to reproduce the problem.
- Remove private data from screenshots and logs before you attach them.
- Report security problems privately, as described in [SECURITY.md](SECURITY.md).

## Setting up

You need Node 24.13+ and pnpm 10.29.3. `.node-version` records the tested Node
version, and `rust-toolchain.toml` selects Rust 1.98.1 automatically.

For the native desktop app, use Windows x64 with Rust's
`x86_64-pc-windows-msvc` toolchain, Visual Studio 2022 Build Tools with
**Desktop development with C++** and a Windows SDK, and WebView2 Runtime.
Install missing Windows OCR language packs to test text recognition.
The browser UI and API run on Windows, Linux and macOS without Rust.

```bash
git clone https://github.com/algorithco/AlgorithShot.git
cd AlgorithShot
pnpm install --frozen-lockfile
pnpm desktop:dev       # the Tauri desktop app
pnpm dev               # desktop pages in a browser, with fake data
pnpm api:dev           # the API on http://127.0.0.1:3000
```

In the browser, `pnpm dev` takes these URL options: `?lang=uz`, `?theme=dark`,
`?setup` (first run) and `?empty` (empty library). See the
[desktop guide](desktop/README.md) and the [API guide](shot-api/README.md) for
more.

The API uses documented defaults without a `.env` file. For custom settings,
copy `shot-api/.env.example` to `shot-api/.env`; never commit your local `.env`.
Development and CI need no release secrets or signing keys.

To build a standalone Windows executable from the repository root:

```bash
pnpm desktop:build:local         # target/local/release/algorithco-shot.exe
pnpm desktop:build:local --debug # target/local/debug/algorithco-shot.exe
```

Both outputs are under `desktop/src-tauri/`. Local builds disable updater
endpoints and signature generation, and use a separate Cargo target directory.
They do not read the maintainer's local signing key. Run the executable directly;
the [signed installer](desktop/docs/UPDATES.md) is a maintainer release task.

## Making a change

1. Fork the repository, clone your fork, then create a branch from `main` with a
   short descriptive name, such as `settings-groups`. Maintainers with write
   access can create a branch in this repository.
2. Keep each pull request to one topic, and split unrelated changes into
   separate commits.
3. Write commit messages in the
   [Conventional Commits](https://www.conventionalcommits.org) style used in
   the history, with a scope. Examples: `feat(capture): ...`, `fix(setup): ...`,
   `refactor(library): ...`, `chore(ci): ...`. Write the subject in the
   imperative mood and lower case, and explain the reason in the body.
4. Run the checks before you push:

   ```bash
   pnpm typecheck
   pnpm test
   pnpm test:release
   pnpm build
   cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib
   ```

5. Open a pull request into `main` and fill in the template. The required `CI`
   check summarizes `pages`, `core` (Windows), `audit` and `secrets`. CI skips
   Rust tests that need a real screen or Windows' OCR languages, so run those
   on your PC when you change capture or OCR. A maintainer may need to approve
   your first workflow run. Fork workflows run without release credentials.
6. A maintainer reviews the pull request and merges it.

## Guidelines

- Match the surrounding code: its naming, idioms, formatting and amount of
  comments.
- User-facing text goes in `desktop/src/shared/i18n/`, in English, Uzbek and
  Russian. `pnpm typecheck` fails if a language is missing a key.
- New settings go in `desktop/src-tauri/src/settings.rs` with a default, so
  older settings files still load. Also add them to the `Settings` type in
  `desktop/src/shared/api.ts` and to the fake data in `desktop/src/dev/mock.ts`.
- The app works offline, and nothing is uploaded. Discuss any new network
  request or data collection with the maintainers first. Official builds check
  the public update feed; local standalone builds disable those checks.
- Keep the UI usable from the keyboard, with visible focus, and respect reduced
  motion.
- Never commit secrets. The updater signing key stays in the ignored
  `desktop/.local/` folder, and CI scans every commit with Gitleaks.
- Keep upstream copyright and license notices when copying or adapting code.
  Document new bundled third-party code in `THIRD_PARTY_NOTICES.md`.

## Contribution license

By submitting a contribution, you agree to license it under the project's
MIT License. You retain copyright in your work. Only submit material you have
the right to contribute, and identify any third-party code and its license.
No separate contributor license agreement is required.

## Releases

Maintainers publish releases. The steps are in
[desktop/docs/UPDATES.md](desktop/docs/UPDATES.md).
