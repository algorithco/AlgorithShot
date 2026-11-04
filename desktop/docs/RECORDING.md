# Screen recording

The first recording implementation is Windows-only and saves silent H.264 video
in an MP4 container. Screenshot capture is unchanged. Microphone/system audio,
region recording, trimming, replay buffers and other platforms are later work;
the recorder does not offer controls for features it cannot perform.

## Use

Open **Record video**, choose a display or a visible window, choose 30 or 60 fps,
and press **Start recording**. The pointer is optional. Native pixel dimensions
are preserved, except that odd dimensions lose at most one right/bottom pixel
because the H.264 output needs even dimensions. The current limit is 4096 pixels
in either dimension. Restore minimized windows before selecting them.

**Ctrl+Shift+F9** stops and saves from any app. The recorder reserves this shortcut
independently of screenshot hotkeys and refuses to start if it is unavailable.
Closing the controls or minimizing the main window does not stop recording.
Closing the main window keeps the tray app running as before. Explicit Quit waits
for finalization; installing an update requires stopping the recording first.

Files are saved under `Recordings` in the configured screenshot folder. File names
include a timestamp and UUID; recordings do not overwrite existing files. The
completion panel opens the video with the default player or shows it in its folder.
Recordings are separate from the screenshot library and its OCR/privacy pipeline.
The current panel remembers the latest session until the app exits; files remain
in the recording folder across restarts and uninstalling the app.

A display recording includes anything visible on that display, including the
recorder controls if they are left visible. Minimize the app and use the stop
shortcut to keep those controls out of a display recording. No screenshot privacy
checks or automatic video redaction are applied. Nothing is uploaded.

## Native pipeline

`Windows Graphics Capture -> D3D11 crop and NV12 conversion -> hardware H.264 -> fragmented MP4`

The engine uses the existing `windows` Rust dependency, with additional API
features, and Windows-provided codecs. No FFmpeg binary or additional recording
crate is bundled. The selected Media Foundation encoder must expose a hardware
MFT identity; silently falling back to a CPU encoder is deliberately refused.
Windows 10 version 2004 or newer, Media Foundation and a compatible GPU driver
are required. HDR displays are rejected until proper HDR/tone-mapping support is
implemented. A window-size change stops capture and attempts finalization instead
of stretching the content or continuing with stale dimensions.

The WGC frame pool has two buffers. Its handoff retains only the latest frame,
and the encoder allocator has a bounded set of reusable GPU surfaces. Frame
pixels never cross webview IPC and are not encoded as PNGs or read into CPU image
buffers. If the encoder cannot keep up, raw input frames can be skipped while
timestamps preserve real-time playback. This is reported in recording status.
Static screens repeat the last GPU texture so the output keeps its duration.
Background thumbnail, PNG optimization and OCR jobs wait while recording is active.

Fragmented MP4 is written during recording to preserve completed fragments on an
interrupted session. Finalization errors leave that recording's file in place;
the app never deletes it automatically. Recovery is best-effort, not a guarantee
against disk failure or power loss before data reaches stable storage.

## Verification

Use a dedicated build target, rather than replacing another session's executable:

```powershell
cargo check --manifest-path desktop/src-tauri/Cargo.toml --target-dir .local/recording-app-target --locked
cargo test --manifest-path desktop/src-tauri/Cargo.toml --target-dir .local/recording-app-target --lib recording:: --locked
```

The native app accepts `--verify-recording <output-directory>`. This check runs
before single-instance forwarding, user settings, tray, hotkeys and screenshot
storage. It creates its own animated synthetic window, captures only that HWND,
records at 30 fps and 1080p60, then decodes both files. It covers back-to-back
sessions, explicit Stop, closing the source window, and a static tail. It checks
dimensions, duration, frame count, increasing timestamps and decoded content.
The generated windows stay behind other windows. The verifier preserves its
UUID output for inspection.

`desktop/dev/recording-preview.html` is a development-only UI fixture. Its controls
use simulated source/status data and never capture the screen. The production
build does not include this page.

Before release, measure 1080p30/60 and supported 1440p/4K modes over 30–60 minutes
on Intel, AMD and NVIDIA hardware. Compare app responsiveness with recording off/on;
track encoder stalls, skipped frames, memory/GPU allocations and disk throughput.
Also test mixed-DPI/rotated displays, hybrid GPUs, source closure and resizing,
sleep/lock, disk-full errors, permissions, hotkey conflicts, quit and update races.
Hardware acceleration is an implementation choice, not proof of lag-free behavior.
