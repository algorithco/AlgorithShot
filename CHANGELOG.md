# Changelog

## 0.2.1 — 2026-10-26

- Publish official desktop installers, signatures and the update feed alongside
  the source in the AlgorithShot repository.
- Point the desktop updater and all download links at the same repository.
- Versions 0.1.2 and 0.2.0 need a one-time manual installation of 0.2.1 or newer
  because their embedded update location has been retired.

## 0.2.0 — 2026-10-26

- Release the desktop app and Shot API source under the MIT License.
- Add native macOS and Linux X11 backends for capture, clipboard, global
  shortcuts, application icons, accessibility-based selection and browser context.
- Bundle offline English, Russian and Uzbek OCR on macOS/Linux and an offline
  face detector for privacy review.
- Support macOS Trash undo while preserving screenshots and edited originals.
- Support Command shortcuts for library selection, search and copying on macOS.
- Add builds without private signing keys, tests on all three operating systems,
  native WebKit OCR verification, and coordinated multi-platform update manifests.
- Add contributor and maintainer guides, branding guidelines, a roadmap,
  dependency updates, model checksums and preserved upstream license notices.
- Use Ctrl+Alt+A as the default capture shortcut; Windows also supports Print Screen.
- Improve the editor's crop controls, drawing brushes, color selection and undo
  behavior, including pixel alignment and bitmap cleanup during long sessions.

## 0.1.2

- Publish Windows installers and the update feed in the public release repository.
- Verify embedded desktop assets before preparing an installer.
