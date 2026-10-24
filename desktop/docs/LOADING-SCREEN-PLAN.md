# Branded startup screen

## Goal

Replace the blank main-window startup with a polished, animated AlgorithShot
loading screen, then build and run the Windows app locally.

## Design

- Use the existing viewfinder-and-dot logo as the source of the artwork.
- Keep the brand palette: ink `#111111`, white, and yellow `#ffd300`.
- Animate the logo itself: four independent, extruded white corners approach
  a lit yellow sphere from different depths and settle into the source logo.
- Finish the focusing movement with a thin scan line and expanding capture wave.
  Use subtle optical guides and a quiet yellow glow. There is no rotating tile.
- Keep the app name, current startup status, and one indeterminate activity line
  readable. No invented percentages or simulated startup tasks.

## Implementation and safety

1. Show an ink background and a small static logo before React mounts. Set the
   native main-window background to the same ink to prevent a white flash.
2. Add a main-window startup boundary that loads settings and the initial library
   data before revealing the app. Other window types keep their existing flow.
3. Run a 3.5-second introduction alongside real initialization, then fade directly
   into the ready app. Honor reduced motion and avoid waiting for looping motion.
4. Provide a bounded startup timeout and a retry action. Ignore stale completions
   and clean up timers when the boundary unmounts or a retry starts.
5. Translate new text into English, Uzbek, and Russian. Keep the logo decorative
   and announce only meaningful status changes to assistive technology.
6. Keep all assets local and add no packages, network requests, or permissions.
   Do not change screenshot capture, settings values, stored images, or the DB.

## Validation and delivery

- Exercise readiness, failure, retry, timeout, and cancellation behavior.
- Run the frontend tests and production build, and check the Rust change.
- Inspect the rendered loader at desktop and narrow sizes and the transition
  to the normal app. Verify reduced-motion timing and the CSS animation opt-out.
- Build the Windows executable and installer, then launch the new local build.

## Status

Implemented the independent-corner focus animation and extended the minimum
presentation to 3.5 seconds following design feedback.

- 29 frontend tests pass, including startup readiness, the minimum presentation,
  slow initialization, errors, retry, timeout, abort, and settings-sync recovery.
- The production frontend build and offline Rust check pass.
- Desktop artwork, intermediate assembly frames, Uzbek/Russian text, the error
  state at 390 × 560, and the retry control were inspected in the local preview.
- The real startup flow was observed handing off to the screenshot library.
- Preview controls and browser mocks are excluded from production output.
- The final optimized Windows executable and NSIS installer built successfully.
  The executable contains the verified final assets `main-B3gcez2a.css` and
  `main-DTL901si.js`.
- A native preview of the new animation was launched from the workspace and its
  running process was verified. The user stopped Computer Use with Escape during
  native inspection. No further desktop interaction was performed, so a complete
  visual inspection of the final native package remains unverified.

## Local build artifacts

- App: `src-tauri/target/release/algorithco-shot.exe` (12,828,160 bytes).
- Installer: `src-tauri/target/release/bundle/nsis/AlgorithShot_0.1.0_x64-setup.exe`
  (4,177,041 bytes).
- App SHA-256: `F559ECD1C098A46309221450AD27F614A718C21B935B509F981986875A3645BE`.
- Installer SHA-256: `A1315F19671F12E648C6375AED153BDC19F598AE6936D1844DFB51A75886FBE7`.

Development-only previews are available at `/?loading-preview=workspace`.
Use `&language=uz` or `&language=ru`, `&size=compact`, and `&frame=1200` to inspect
translations, a narrow viewport, or a specific animation frame.
