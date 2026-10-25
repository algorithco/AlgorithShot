# Contributing to AlgorithShot

AlgorithShot is proprietary software and is not open source (see
[LICENSE](LICENSE)). This repository is private: only the Algorithco team and
the people we have invited can see it and contribute to it. Anyone with access
can report bugs and suggest features. Security problems are reported as
described in [SECURITY.md](SECURITY.md).

By taking part, you agree to follow the [code of conduct](CODE_OF_CONDUCT.md).

## Bugs and ideas

- Search the [existing issues](https://github.com/algorithco/algorith-shot/issues)
  first.
- Open a new issue with the **Bug report** or **Feature request** form.
- Include the version (shown in **Settings › About**), your Windows version, your
  monitors and scaling, and the steps to reproduce the problem.
- Remove private data from screenshots and logs before you attach them.
- Report security problems privately, as described in [SECURITY.md](SECURITY.md).

## Setting up

You need Node 24.13+ and pnpm 10.29.3. The desktop app also needs Windows,
Rust (MSVC) and the Visual Studio C++ build tools. The API only needs Node and
pnpm.

```bash
pnpm install --frozen-lockfile
pnpm desktop:dev       # the Tauri desktop app
pnpm dev               # desktop pages in a browser, with fake data
pnpm api:dev           # the API on http://127.0.0.1:3000
```

In the browser, `pnpm dev` takes these URL options: `?lang=uz`, `?theme=dark`,
`?setup` (first run) and `?empty` (empty library). See the
[desktop guide](desktop/README.md) and the [API guide](shot-api/README.md) for
more.

## Making a change

1. Create a branch from `main` with a short descriptive name, such as
   `settings-groups`.
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

5. Open a pull request into `main` and fill in the template. CI must pass: the
   `pages`, `core` (Windows), `audit` and `secrets` jobs. CI skips the Rust tests
   that need a real screen or Windows' OCR languages, so run those on your PC.
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
  request or data collection with the maintainers first.
- Keep the UI usable from the keyboard, with visible focus, and respect reduced
  motion.
- Never commit secrets. The updater signing key stays in the ignored
  `desktop/.local/` folder, and CI scans every commit with Gitleaks.

## Releases

Maintainers publish releases. The steps are in
[desktop/docs/UPDATES.md](desktop/docs/UPDATES.md).
