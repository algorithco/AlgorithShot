# Algorithco Shot

A Windows screenshot app that captures exactly what you need, finds it again in
seconds, and helps you share it safely. Free, offline, in English, Uzbek and
Russian. The plan and the reasons behind it are in [docs/PLAN.md](docs/PLAN.md).

## What it does

- **Capture**: one hotkey (Print Screen, or Ctrl+Shift+Print Screen) freezes the
  screen. Drag a region, click a window or a part of it (buttons, panels,
  messages via UI Automation), capture the full screen or a fixed size, or use a
  timer. Letting go copies the capture at once; hold Ctrl to adjust it first
  with the live size in real pixels, arrow-key nudging and typed sizes.
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

Nothing is uploaded. Screenshots are saved to `Pictures\Algorithco Shot`
(or `%USERPROFILE%\Pictures\Algorithco Shot` when Pictures is in OneDrive).

## Develop

Needs Node 20+, pnpm, Rust (MSVC) and the Visual Studio C++ build tools.

```bash
pnpm install
pnpm tauri dev        # run the app
pnpm dev              # pages only, in a browser, with fake data (src/dev/mock.ts)
pnpm test             # frontend tests
cargo test --manifest-path src-tauri/Cargo.toml --lib   # Rust tests, incl. Windows OCR and a real screen grab
pnpm tauri build      # Windows installer in src-tauri/target/release/bundle/nsis
```

CI (`.github/workflows/ci.yml`) runs the same checks on every pull request,
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

## License

Not open source: all rights reserved. See [LICENSE](LICENSE).
