# AlgorithShot

A Windows screenshot app that captures exactly what you need, finds it again in
seconds, and helps you share it safely. Free, offline, in English, Uzbek and
Russian. The plan and the reasons behind it are in [docs/PLAN.md](docs/PLAN.md).

## What it does

- **Capture**: one hotkey (Print Screen, or Ctrl+Shift+Print Screen) freezes the
  screen. Drag a region, click a window, capture the full screen or a fixed size,
  or use a timer. With **Highlight the window under the pointer** turned on in
  Settings, a click in Region mode also captures a window or a part of it
  (buttons, panels, messages via UI Automation). Letting go copies the capture at
  once; hold Ctrl to adjust it first with the live size in real pixels, arrow-key
  nudging and typed sizes.
- **Screen tools**: copy text from anything on screen (Windows OCR): the screen
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

Nothing is uploaded. Screenshots are saved to `Pictures\AlgorithShot`
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

Run these commands from `desktop/`. Needs Node 24.13+, pnpm, Rust (MSVC) and
the Visual Studio C++ build tools. The repository root also exposes desktop
and API commands; see [the workspace README](../README.md).

```bash
pnpm install
pnpm tauri dev        # run the app
pnpm dev              # pages only, in a browser, with fake data (src/dev/mock.ts)
pnpm test             # frontend tests
cargo test --manifest-path src-tauri/Cargo.toml --lib   # Rust tests, incl. Windows OCR and a real screen grab
pnpm release:build    # signed Windows installer + latest.json (see docs/UPDATES.md)
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
  shared/      API types, translations (en, uz, ru), styles, UI pieces
```

In-app update setup, signed local release builds, and publishing instructions are
in [docs/UPDATES.md](docs/UPDATES.md). The app checks for updates automatically;
installation starts when the user clicks the banner.

## License

Not open source: all rights reserved. See [LICENSE](../LICENSE).
