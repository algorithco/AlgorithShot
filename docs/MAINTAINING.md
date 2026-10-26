# Maintaining AlgorithShot

The desktop app and Shot API use the [MIT License](../LICENSE). Contributors
retain copyright in their work. Review third-party code and contributor
permissions before incorporating or relicensing it.

## Reviews and repository settings

The source repository is `algorithco/AlgorithShot`. Official installer assets
and the update feed are in `algorithco/algorith-shot-releases`.

Protect `main` with these settings:

- Require a pull request and at least one approving review, including a code
  owner review. Dismiss stale approvals after new commits.
- Require the aggregate `CI` check to pass against the current base branch,
  and resolve review conversations before merging.
- Block force pushes and branch deletion, including for administrators.
- Keep Actions' default token read-only, and disable workflow approval of PRs.
- Require approval before running workflows from first-time fork contributors.
- Keep secret scanning and push protection enabled; enable Dependabot alerts
  and security updates. `.github/dependabot.yml` schedules version updates.

These are GitHub settings; committing this file does not apply them.
The CI workflow uses `pull_request`, pinned Actions and checkout without
persisted credentials. Fork builds need no signing keys or release tokens.
Never run untrusted pull request code in a privileged `pull_request_target`
or release workflow.

`CODEOWNERS` identifies the reviewers. Update it when maintainership changes.
Use `good first issue` for a small, scoped task with acceptance criteria,
and `help wanted` when contributions would be useful. Review bugs and pull
requests as maintainer availability permits.

## Security review

Handle reports through [SECURITY.md](../SECURITY.md). Avoid including private
screenshots, database contents, tokens or signing material in issues or logs.
Private signing keys belong outside Git and outside fork workflows.

Before an open-source announcement or publishing previously private history:

1. Fetch the branches and tags that will be published. Review ownership and
   contributor permission to release the code under MIT.
2. Scan history with `gitleaks git . --log-opts="--all --full-history" --redact`.
   Also scan a copy of the files being published, including untracked additions.
3. Review old Actions logs, artifacts, release attachments, issue uploads and
   any other previously private material. Changing visibility exposes Actions
   history as described in [GitHub's visibility documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility).
4. Revoke exposed credentials before removing them. For an exposed updater
   key, plan the transition for installed apps that trust the old public key.
   Do not silently replace the trusted key or existing update feed.
5. Verify an anonymous clone, install, build and documentation links after
   publishing. A successful scanner run supplements manual review.

## Before a release

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:release
pnpm test:ocr
pnpm build
pnpm desktop:build:local --debug
cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib --locked
pnpm audit --prod --audit-level high
```

Run native checks on each supported OS. Capture tests need an interactive
desktop; Windows OCR tests need the appropriate language packs. CI excludes
those interactive tests and verifies macOS/Linux OCR through the real native
webview with bundled offline models. Run capture tests locally when their
functionality changes. Full Linux desktop support requires X11.

Review dependency licenses and advisories from both lockfiles. For JavaScript,
use `pnpm licenses list` after installing dependencies. For Rust, inspect
`cargo metadata --locked --format-version 1` and the dependency LICENSE/NOTICE
files, including bundled C/C++ libraries. Preserve required attribution and
include applicable texts with binary distributions. The release builder gathers
upstream license and NOTICE texts into a resource in each installer and a
platform-specific report alongside the release assets. See
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

Follow [UPDATES.md](../desktop/docs/UPDATES.md) to build all platform installers,
sign updater artifacts locally and verify the full cohort. Match its version
and tag to the exact source commit, and link that
tag in the release notes. Include a changelog and known limitations. Keep
`latest.json` on the existing public feed so installed apps can update.

The updater signature is separate from Windows Authenticode code signing.
Only publish artifacts built from a reviewed source commit by a maintainer.
Verify a real upgrade, preserved screenshots/settings, and uninstall behavior
before publishing a release that changes installation or storage.
