# Guided desktop setup

Replace the introductory welcome page with a complete five-step setup after the
branded loading animation. Show it once for new users and for existing users who
have only completed the older welcome page. Let users reopen it from Settings.

1. Personalize: language, live appearance preview, and starting with Windows.
2. Capture: primary, backup, and optional shortcuts; snapping options; real
   shortcut conflicts and a way to open Windows' Print Screen setting.
3. Saving and workflow: destination, file naming and preview, format and quality,
   automatic saving, clipboard, quick card, and editor behavior.
4. Smart features: searchable text, privacy checks, and optional automatic cleanup.
5. Review: editable summary, validation, one explicit save action, and a ready state.

Keep edits in a local draft until the final save succeeds. Preserve old settings
and screenshot files. Store a versioned completion marker only with the saved
choices; a failed save must keep the setup open with the draft intact. Validate
the selected destination and report failures instead of completing silently.

Use the existing ink, paper, and yellow palette with a dark navigation rail,
clear progress, spacious controls, responsive internal scrolling, keyboard
navigation, visible focus, reduced-motion support, and English/Uzbek/Russian text.

Verify gating and persistence, draft validation and failed saves, shortcut
recording, all steps, long translations, and the minimum desktop window size.
Finish all source and visual checks before building the final Windows package.

## Verification

- TypeScript and the production frontend build pass.
- 53 frontend tests and 8 existing release tests pass after matching the updater
  and process JavaScript packages to the installed Rust plugin versions.
- Six focused Rust settings tests pass, including the older welcome migration,
  saved setup choices/completion on reload, and the destination write probe.
- The initial Uzbek setup, live light/dark theme preview, and capture controls
  were inspected in the browser before browser control became unavailable.
- An isolated native QA build uses identifier `com.algorithco.shot.setupqa` and a
  separate empty capture folder so native testing does not change real settings.

Native step-by-step verification and the final local build are in progress.
