# AlgorithShot Windows installer

The installer uses a compact white canvas, dark text (`#171a21`), yellow
(`#ffd300`), Segoe UI and the viewfinder mark. A horizontal brand header and
consistent footer leave room for readable content. The primary action is at
the bottom right. Welcome uses small capture, edit and search icons; finish
groups the optional launch and desktop shortcut checkboxes.

- `installer.nsi` keeps Tauri's installation, WebView2, upgrade, passive/silent,
  shortcut and uninstall logic. Presentation callbacks are in `theme.nsh`.
- `native/ShotUI.cpp` lays out the existing native controls and paints the
  header, icons, folder field and buttons. Directory validation, keyboard navigation, screen reader
  text, checkboxes and button activation remain native. The drawing code uses
  Windows' DPI and retains the system button renderer in High Contrast mode.
- Setup, maintenance and uninstall always use English, including WebView2
  errors and upgrades from an older localized installer. Only English resources
  are bundled. There is no language selector or persisted language preference.
  Product messages are in `languages/English.nsh`.
- The default install remains per user. Launch is checked on the finish page;
  the desktop shortcut is optional and starts unchecked. Successful installation
  continues to the finish page; errors keep the details available.
- Uninstall keeps screenshots. The optional data checkbox clears known settings
  and index files, using the existing `ShotDeleteSettingsAndIndex` macro.

## Build

`pnpm release:build` prepares a signed local release using the project's updater
configuration; see `docs/UPDATES.md`. Tauri runs `dev/build-installer-ui.ps1`
before bundling. It finds
MSVC through `vswhere` and builds the plug-in with `/W4 /WX` and the static C++
runtime. The plug-in is always x86 because NSIS itself is x86, including for
x64/ARM64 applications. Its output stays in `src-tauri/target/installer-ui/x86`;
there are no committed DLLs or extra runtime prerequisites.

For bundling an already compiled application during UI development,
`pnpm tauri bundle --bundles nsis` is sufficient. Release compilation still
requires the configured updater public key; keep the normal release workflow
for deliverable builds.

## Inspect the actual dialogs

After bundling on Windows:

```powershell
powershell -NoProfile -File dev/preview-installer.ps1
```

If needed, pass `-NsisDirectory` with the cached Tauri NSIS directory.
This compiles a disposable copy of Tauri's generated script. Installation
sections, application launch, shortcuts, initialization and registry writes
are replaced before it executes. The fixture walks the real native pages and
saves BMPs plus control text/geometry/font information for welcome, license,
maintenance, directory, progress, finish, uninstall confirmation and uninstall progress in
`dev/installer-qa.local/captures/96dpi/`. It fails if a visible label's text is
clipped. It does not
install or remove AlgorithShot. Its test-only C++ entry point is excluded from
the production DLL. Only a fixture uninstaller is written inside that ignored
preview directory. Registry persistence is disabled. Compiler warnings about unused install code are expected
only in this stripped fixture.

Use `-Dpi 120`, `-Dpi 144` or `-Dpi 192` to verify 125%, 150% and 200% layouts
without changing Windows display settings. Captures go into separate DPI
directories. The DPI override exists only in the preview DLL.

Use `-Interactive` to build a preview for manual keyboard and focus checks.
Open the printed `installer-preview.exe` path; it uses the same harmless
sections and never launches the application or creates shortcuts. The preview
always includes maintenance with fixture data, without inspecting an existing
installation.

To treat every warning in the production script as an error, run
`makensis /WX /V3 installer.nsi` in `src-tauri/target/release/nsis/x64` after
bundling. Do not run that generated installer as a UI-only preview.

## Research and maintenance

The template is derived from Tauri's official NSIS script at commit
`c464ef928c35d7eedd64bcd5df16b62b3393b7fa`, under the included
`TAURI-LICENSE-MIT`. When upgrading the CLI, compare the upstream installation
logic before merging template changes; preserve the screenshot-safe cleanup.
Our translations use the corrected `chooseHowToInstall` key, so the upstream
misspelled legacy-language fallback is omitted.

References used for this implementation:

- [Tauri Windows installer customization](https://v2.tauri.app/distribute/windows-installer/)
- [Tauri NSIS configuration](https://v2.tauri.app/reference/config/#nsisconfig)
- [NSIS Modern UI 2](https://nsis.sourceforge.io/Docs/Modern%20UI%202/Readme.html)
- [NSIS nsDialogs](https://nsis.sourceforge.io/Docs/nsDialogs/Readme.html)
- [Microsoft custom controls and accessibility](https://learn.microsoft.com/en-us/windows/win32/controls/user-controls-intro)
- [Microsoft control subclassing](https://learn.microsoft.com/en-us/windows/win32/controls/subclassing-overview)
