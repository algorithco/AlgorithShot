# Desktop capture compatibility

The capture button must open a usable picker, including after cancellation or a
failed capture. The capture backend follows the actual desktop session:

| Environment | Capture and selection | Requirements |
| --- | --- | --- |
| Windows | Native pixel capture and one selection window per display | Interactive desktop |
| Linux X11 | Native X11 capture and one selection window per display | X11 display, WebKitGTK 4.1 |
| Linux Wayland | Desktop Screenshot portal's region/window/screen picker | Session D-Bus, `xdg-desktop-portal` and a backend implementing Screenshot |
| macOS 14+ | ScreenCaptureKit screenshot manager and native selection windows | Screen Recording permission |
| macOS 12–13 | Core Graphics capture and native selection windows | Screen Recording permission |

Wayland compositors intentionally restrict reading the desktop, moving application
windows to global coordinates and registering global keyboard shortcuts. The app
does not depend on XWayland for capture. Color, ruler and fixed-size tools review
the portal image in a normal window. OCR, QR, copying, editing and saving operate
on the returned pixels. An older portal may let the user choose its own capture
target instead of accepting the requested mode; target hints are sent only when
the installed portal advertises support.

Global shortcuts use the GlobalShortcuts portal on Wayland. The desktop may ask
the user to choose or approve a trigger, and the UI displays the assigned trigger.
If a desktop does not implement that portal, the capture button still works;
a custom desktop keyboard shortcut can run `algorithco-shot --capture`.
GNOME, KDE and wlroots sessions must have a compatible Screenshot backend enabled
by their distribution. Installing the portal frontend alone is insufficient.

macOS asks for Screen Recording access before capture. A denied request produces
an actionable error. The user may need to quit and reopen the installed app after
allowing access in System Settings. Accessibility is needed for additional UI
element metadata, rather than ordinary image capture. Code signing and notarization
are separate release requirements; an ad-hoc bundle is not a notarized installer.

Linux release builds use Ubuntu 22.04, reducing the glibc baseline from 2.39 to
2.35. This does not promise compatibility with every historical distribution or
CPU architecture. Published Linux packages currently target x86_64; macOS bundles
target Intel and Apple Silicon. System WebKit versions without OffscreenCanvas 2D
use a regular canvas for image editing and decoding.

## Verification

CI builds Windows, macOS 15, Ubuntu 22.04 and Ubuntu 24.04. `--verify-overlay`
uses generated RGBA pixels and an isolated temporary library to exercise the real
webview, image protocol, listener handshake, visibility, cancellation and reopening.
Linux also exercises native Wayland windows in a headless Weston compositor with
`DISPLAY` unset. D-Bus tests use a private mock portal to cover responses arriving
before method return, cancellation and timeout. These tests do not require access
to a real user's screenshots or their library.

Before a release, also verify the following on real desktops:

- GNOME Wayland, KDE Wayland, a wlroots session and X11: capture via the button,
  accept/deny/cancel a portal dialog, change shortcuts, capture again.
- macOS 12/13 and current macOS, both CPU architectures: first permission request,
  denial, approval and restart, then region/window/fullscreen capture.
- Mixed Retina/1x or fractional-DPI displays, negative origins and hot plugging:
  correct frame dimensions, window selection, cropping and native placement.
- Save, copy, OCR, QR, color, ruler, fixed size and editor blur after capture.

The automatic checks cover startup regressions; they do not replace compositor
dialogs, macOS privacy consent, driver and hardware checks on real machines.

## Primary references

- [XDG Screenshot portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Screenshot.html)
- [XDG GlobalShortcuts portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html)
- [XDG shortcut syntax](https://specifications.freedesktop.org/shortcuts/latest/)
- [Apple: ScreenCaptureKit screenshot API](https://developer.apple.com/videos/play/wwdc2023/10136/)
- [WebKit: OffscreenCanvas 2D availability](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/)
- [Tauri: Linux build baseline](https://v2.tauri.app/distribute/appimage/#limitations)
