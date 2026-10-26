# AlgorithShot

A screenshot app for Windows, macOS and Linux X11 that captures exactly what you need, finds it again in
seconds, and helps you share it safely. Free, offline, in English, Uzbek and
Russian. The plan and the reasons behind it are in [docs/PLAN.md](docs/PLAN.md).

## What it does

- **Capture**: one hotkey (Ctrl+Alt+A, or Print Screen) freezes the
  screen. Drag a region, click a window, capture the full screen or a fixed size,
  or use a timer. With **Highlight the window under the pointer** turned on in
  Settings, a click in Region mode also captures a window or a part of it
  (buttons, panels and messages via the platform accessibility API). Letting go copies the capture at
  once; hold Ctrl to adjust it first with the live size in real pixels, arrow-key
  nudging and typed sizes. Change hotkeys in Settings; upgrades preserve saved
  bindings.
- **Screen tools**: copy text from anything on screen with offline OCR: the screen
  stays frozen and you pick the words right there. Scan QR codes and barcodes,
  pick colours, measure with the ruler, pin a capture on top.
- **Quick card** after each capture: edit, save as, pin, send to Telegram, copy,
  show in folder, delete, or drag the image straight into another app.
- **Editor**: crop, erase, remove & fill, cut out a strip, hide (pixelate, blur,
  solid), arrows, boxes, highlighter, text, numbered steps, perfect sizes and
  presets, "keep under N KB", and a privacy check that hides emails, phone
  numbers, cards, IDs, keys and faces in one go.
- **Library**: every screenshot, searchable by the text inside it, the app, the
  window title or website and the date (Latin and Cyrillic both match). Delete
  goes to the Recycle Bin with undo; the clean-up page finds duplicates and
  old or large files.

Nothing is uploaded. Screenshots are saved to your `Pictures/AlgorithShot` folder
(or `%USERPROFILE%\Pictures\AlgorithShot` when Pictures is in OneDrive).
Saved screenshots stay on disk after uninstalling the app, including when
the uninstaller's **Remove settings and the library index** option is selected. Untouched originals
of edited screenshots live in the `.originals` subfolder of that Pictures
folder. Only settings, the searchable index and thumbnails live in app data.
On upgrade, the app preserves legacy originals and recovers screenshots
previously saved inside its installation, data, cache or temporary folders.
New saves must use a folder outside those locations. Reinstalling rebuilds
the library from the images in the default save folder; custom folders can
be selected again in Settings. Files are removed only by an explicit delete
or by automatic clean-up if you enable it.
The uninstaller clears known settings and index files without recursively
deleting app-data folders, preserving legacy images even before the first
launch after an upgrade.

## Develop

Run these commands from `desktop/`. Needs Node 24.13+, pnpm, Rust and the
platform tools listed in [CONTRIBUTING.md](../CONTRIBUTING.md). The repository root also exposes desktop
and API commands; see [the workspace README](../README.md).

```bash
pnpm install
pnpm tauri dev        # run the app
pnpm dev              # pages only, in a browser, with fake data (src/dev/mock.ts)
pnpm test             # frontend tests
cargo test --manifest-path src-tauri/Cargo.toml --lib   # Rust tests, incl. Windows OCR and a real screen grab
pnpm build:local      # standalone native executable; no private key needed
pnpm test:ocr         # offline English/Russian/Uzbek recognition
pnpm release:build    # unsigned installers for maintainer review
powershell -File dev/test-uninstall-storage.ps1 # isolated NSIS image-preservation test (requires NSIS from a Tauri build)
```

CI (`../.github/workflows/ci.yml`) runs the same checks on every pull request,
except the tests that need a real screen or Windows' OCR languages.

Command-line actions (also sent to the running app): `--capture [mode]`,
`--text`, `--qr`, `--library`, `--settings`, `--hidden`.

## Layout

```
src-tauri/src/
  capture.rs   screen grab, capture sessions, what happens after a capture
  win.rs       monitors, windows, DPI (Win32)
  platform/    macOS/Linux capture, clipboard, shortcuts, icons and accessibility
  imaging.rs   crop, encode, optimize, resize, fit, smart fill
  library.rs   SQLite index and full-text search
  shots.rs     saving, naming, Recycle Bin delete and undo, edits, clean-up
  smart/       OCR, privacy shield, QR, faces, UI Automation, fingerprints
  editor.rs    editor commands (raw pixel transfer)
  protocol.rs  shot:// protocol for frames, thumbnails and images
  wm.rs, tray.rs, hotkeys.rs, card.rs, pins.rs, clipboard.rs, watcher.rs
src/
  overlay/     capture overlay (canvas engine + toolbar)
  card/        quick card
  editor/      editor (document model, renderer, stage, panels)
  library/     library, clean-up, settings, welcome
  pin/         pinned screenshots
  ocr/         hidden offline WASM worker for macOS/Linux
  shared/      API types, translations (en, uz, ru), styles, UI pieces
```

In-app update setup, multi-platform release builds, signing and publishing instructions are
in [docs/UPDATES.md](docs/UPDATES.md). The app checks for updates automatically;
installation starts when the user clicks the banner. Local standalone builds
disable update checks. Their executables are under
`src-tauri/target/local/release/`, or `src-tauri/target/local/debug/` when built
with `pnpm build:local --debug`.

## Platform permissions

On macOS, allow Screen Recording for capture and Accessibility for element
snapping and browser context in System Settings > Privacy & Security.
Windows uses installed OCR language packs. macOS and Linux ship offline English,
Russian, Uzbek Latin and Uzbek Cyrillic models and a local face detector.

Linux's complete capture, window selection and global shortcuts require an
X11 session. Use a desktop with a system tray/AppIndicator for the tray menu.
Wayland compositor restrictions prevent the same window and shortcut access;
Wayland is outside the supported full-feature desktop configuration.

## License

MIT. See [LICENSE](../LICENSE), [third-party notices](../THIRD_PARTY_NOTICES.md)
and the [branding guidelines](../BRANDING.md).
