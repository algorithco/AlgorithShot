# Roadmap

AlgorithShot focuses on fast, offline screenshot capture, local search and
safe sharing on Windows. This is a list of priorities, not release dates.
Discuss substantial changes in an issue before implementing them.

## Current priorities

- Reliable capture across multiple monitors, mixed DPI and different Windows
  display settings.
- OCR and search quality in English, Uzbek and Russian, including Latin and
  Cyrillic matching.
- Clear privacy review before sharing, with tests for redaction and export.
- Safe upgrades and uninstall behavior that preserves screenshots.
- A straightforward contributor setup and reliable builds from source.
- Keyboard accessibility and consistent translations across the app.

## Good places to start

- Improve a setup instruction after following it on a clean Windows machine.
- Check English, Uzbek or Russian text for clarity and consistency.
- Add a small regression case for an existing image, geometry or text-search bug.
- Improve keyboard navigation or a missing accessible name.
- Reproduce an issue and report the app version, Windows build, monitor scaling
  and the smallest steps needed to trigger it.

Maintainers can label well-defined tasks `good first issue` or `help wanted`
after adding the expected behavior, relevant files and verification steps.
See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Future work to discuss

Accounts, uploads and cloud synchronization require separate product and
privacy decisions. The current API exposes health and service information;
it does not implement those features. Native macOS and Linux apps would need
platform-specific capture, OCR and window-management implementations.
