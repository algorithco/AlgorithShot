# Capture the real installer UI without installing, uninstalling, creating
# shortcuts or changing persisted preferences. Requires one tauri bundle first.
param(
    [string]$NsisDirectory = '',
    [ValidateSet(96, 120, 144, 192)]
    [int]$Dpi = 96,
    [switch]$Interactive
)

$ErrorActionPreference = 'Stop'
$previewRepo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$previewRoot = Join-Path $PSScriptRoot 'installer-qa.local'
$generatedRoot = Join-Path $previewRepo 'src-tauri/target/release/nsis/x64'
$generatedScript = Join-Path $generatedRoot 'installer.nsi'
if (-not (Test-Path -LiteralPath $generatedScript)) {
    throw 'Run pnpm tauri bundle --bundles nsis before capturing previews.'
}
if (-not $NsisDirectory) {
    $NsisDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'tauri/NSIS'
}
$compiler = Join-Path $NsisDirectory 'makensis.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw "NSIS compiler missing: $compiler" }
New-Item -ItemType Directory -Path $previewRoot -Force | Out-Null
$captureRoot = Join-Path $previewRoot "captures/$($Dpi)dpi"
New-Item -ItemType Directory -Path $captureRoot -Force | Out-Null

# Work from the actual Tauri-generated script, including all the production
# page definitions. Replace side effects before the fixture can be executed.
$previewSource = Get-Content -LiteralPath $generatedScript -Raw
# A cached bundle can predate the current source version. The UI preview should
# display the same version as the next bundle, without compiling the whole app.
$previewVersion = (Get-Content -LiteralPath (Join-Path $previewRepo 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json).version
$previewSource = $previewSource -replace '(?m)^!define VERSION "[^"]*"', "!define VERSION `"$previewVersion`""
# Tauri copies translations beside the generated script. Always preview the
# current translations rather than those left by an earlier bundle.
$bundledLanguages = [regex]::Matches($previewSource, '(?m)^!insertmacro MUI_LANGUAGE "([^"]+)"')
if ($bundledLanguages.Count -ne 1 -or $bundledLanguages[0].Groups[1].Value -ne 'English') {
    throw 'The cached installer is not English-only. Run pnpm tauri bundle --bundles nsis first.'
}
$previewTranslation = Join-Path $previewRepo 'src-tauri/windows/languages/English.nsh'
$previewSource = [regex]::Replace($previewSource,
    '(?m)^\s*!include "[^"\r\n]*[\\/]English\.nsh"',
    [System.Text.RegularExpressions.MatchEvaluator]{ param($match) "!include `"$previewTranslation`"" })
# Keep the fixture free of persisted preferences even with an older bundle.
$previewSource = $previewSource -replace '(?m)^!define MUI_LANGDLL_REGISTRY_(ROOT|KEY|VALUENAME)[^\r\n]*', '; Preview has no MUI language registry persistence.'
$previewTheme = Get-Content -LiteralPath (Join-Path $previewRepo 'src-tauri/windows/theme.nsh') -Raw
$previewTheme = $previewTheme -replace '(?m)^\s*WriteRegStr[^\r\n]*', '; Preview does not persist preferences.'
$previewPlugin = Join-Path $previewRoot 'native'
$previewTheme = $previewTheme -replace '(?m)^!addplugindir .*', "!addplugindir /x86-unicode `"$previewPlugin`""
& (Join-Path $PSScriptRoot 'build-installer-ui.ps1') -Preview
if ($LASTEXITCODE -ne 0) { throw 'Preview UI plug-in failed to compile.' }
$themePath = Join-Path $previewRoot 'theme-preview.nsh'
[IO.File]::WriteAllText($themePath, $previewTheme, [Text.UTF8Encoding]::new($true))
$previewSource = $previewSource -replace '(?m)^!include "[^"\r\n]*[\\/]windows[\\/]theme.nsh"', "!include `"$themePath`""
$previewExe = Join-Path $previewRoot 'installer-preview.exe'
$previewSource = $previewSource -replace '(?m)^OutFile .*', "OutFile `"$previewExe`""
$previewSource = $previewSource -replace '(?m)^Page custom PageReinstall PageLeaveReinstall', 'Page custom PreviewMaintenance'
$previewSource = $previewSource -replace '(?ms)^Section WebView2\r?\n.*?^SectionEnd', "Section WebView2`n  Sleep 1200`nSectionEnd"
$previewInstall = "Section Install`n  WriteUninstaller `"$previewRoot\uninstall-preview.exe`"`n  Sleep 1200`nSectionEnd"
$previewSource = [regex]::Replace($previewSource, '(?ms)^Section Install\r?\n.*?^SectionEnd',
    [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $previewInstall })
$previewSource = $previewSource -replace '(?ms)^Section Uninstall\r?\n.*?^SectionEnd', "Section Uninstall`nSectionEnd"
$previewSource = $previewSource -replace '(?ms)^Function \.onInstSuccess\r?\n.*?^FunctionEnd', "Function .onInstSuccess`nFunctionEnd"
$previewInit = @'
Function .onInit
  StrCpy $LANGUAGE ${LANG_ENGLISH}
  StrCpy $INSTDIR "$LOCALAPPDATA\AlgorithShot"
FunctionEnd
'@
$previewSource = [regex]::Replace($previewSource, '(?ms)^Function \.onInit\r?\n.*?^FunctionEnd',
    [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $previewInit })
$previewUninstallInit = $previewInit.Replace('Function .onInit', 'Function un.onInit').Replace('${GetOptions}', '${un.GetOptions}')
$previewSource = [regex]::Replace($previewSource, '(?ms)^Function un\.onInit\r?\n.*?^FunctionEnd',
    [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $previewUninstallInit })
foreach ($functionName in @('RunMainBinary', 'CreateOrUpdateDesktopShortcut', 'CreateOrUpdateStartMenuShortcut', 'PageLeaveReinstall')) {
    $previewSource = [regex]::Replace($previewSource,
        "(?ms)^Function $functionName\r?\n.*?^FunctionEnd", "Function $functionName`nFunctionEnd")
}

$previewSource = $previewSource.Replace('MUI_PAGE_CUSTOMFUNCTION_SHOW ShotWelcomeShow', 'MUI_PAGE_CUSTOMFUNCTION_SHOW PreviewWelcome')
$previewSource = $previewSource.Replace('MUI_PAGE_CUSTOMFUNCTION_SHOW ShotDirectoryShow', 'MUI_PAGE_CUSTOMFUNCTION_SHOW PreviewDirectory')
$previewSource = $previewSource.Replace('MUI_PAGE_CUSTOMFUNCTION_SHOW ShotLicenseShow', 'MUI_PAGE_CUSTOMFUNCTION_SHOW PreviewLicense')
$previewSource = $previewSource.Replace('MUI_PAGE_CUSTOMFUNCTION_SHOW ShotProgressShow', 'MUI_PAGE_CUSTOMFUNCTION_SHOW PreviewProgress')
$previewSource = $previewSource.Replace('MUI_PAGE_CUSTOMFUNCTION_SHOW ShotFinishShow', 'MUI_PAGE_CUSTOMFUNCTION_SHOW PreviewFinish')
$previewSource = $previewSource.Replace('MUI_PAGE_CUSTOMFUNCTION_SHOW un.ConfirmShow', 'MUI_PAGE_CUSTOMFUNCTION_SHOW un.PreviewConfirm')
$previewSource = $previewSource.Replace('MUI_PAGE_CUSTOMFUNCTION_SHOW un.ShotProgressShow', 'MUI_PAGE_CUSTOMFUNCTION_SHOW un.PreviewProgress')
$previewSource = "!define PREVIEW_OUTPUT `"$captureRoot`"`n" + $previewSource
if ($Interactive) { $previewSource = "!define SHOT_PREVIEW_INTERACTIVE`n" + $previewSource }
$previewSource += "`n!include `"$(Join-Path $PSScriptRoot 'installer-preview.nsh')`"`n"

# These invariants make an accidental production installation fail closed.
foreach ($sectionName in @('WebView2', 'Install', 'Uninstall')) {
    $sectionMatch = [regex]::Match($previewSource, "(?ms)^Section $sectionName\r?\n(.*?)^SectionEnd")
    if (-not $sectionMatch.Success -or $sectionMatch.Groups[1].Value -match '\b(File|Exec|WriteReg|Delete|RMDir|CreateShortCut)\b') {
        throw "The preview still contains side effects in section $sectionName."
    }
}
if ($previewSource.Contains('MUI_PAGE_CUSTOMFUNCTION_SHOW ShotWelcomeShow')) {
    throw 'Preview callbacks were not attached.'
}
if ([regex]::Match($previewSource, '(?ms)^Function \.onInit\r?\n(.*?)^FunctionEnd').Value -match '\b(ReadReg|WriteReg|Exec|Call)\w*\b') {
    throw 'Production initialization was not replaced by the preview fixture.'
}
$previewScript = Join-Path $generatedRoot 'installer-preview.nsi'
[IO.File]::WriteAllText($previewScript, $previewSource, [Text.UTF8Encoding]::new($true))
Push-Location $generatedRoot
try {
    & $compiler /V2 $previewScript
    if ($LASTEXITCODE -ne 0) { throw 'Preview compilation failed.' }
}
finally { Pop-Location }

if ($Interactive) {
    Write-Output "Interactive preview (does not install the app): $previewExe"
    return
}

$previousPreviewDpi = $env:SHOT_PREVIEW_DPI
try {
    $env:SHOT_PREVIEW_DPI = [string]$Dpi
    $languageId = 1033
    $previewStarted = [DateTime]::UtcNow
    $previewProcess = Start-Process -FilePath $previewExe -WindowStyle Hidden -PassThru
    if (-not $previewProcess.WaitForExit(20000)) {
        $previewProcess.Kill()
        throw 'Installer preview timed out.'
    }
    if ($previewProcess.ExitCode -ne 0) { throw "Preview exited with code $($previewProcess.ExitCode)." }
    $installPages = @('welcome', 'maintenance', 'directory', 'progress', 'finish')
    if ($previewSource -match '(?m)^!define LICENSE "[^"]+"') { $installPages += 'license' }
    foreach ($pageName in $installPages) {
        $capturePath = Join-Path $captureRoot "$pageName-$languageId.bmp"
        if (-not (Test-Path -LiteralPath $capturePath) -or (Get-Item -LiteralPath $capturePath).LastWriteTimeUtc -lt $previewStarted) {
            throw "Missing or stale preview: $capturePath"
        }
        if (Select-String -LiteralPath "$capturePath.txt" -SimpleMatch 'CLIPPED_TEXT' -Quiet) {
            throw "Clipped text in $capturePath. Inspect its control log."
        }
    }
    $uninstallPreviewExe = Join-Path $previewRoot 'uninstall-preview.exe'
    $uninstallPreviewStarted = [DateTime]::UtcNow
    $uninstallPreviewProcess = Start-Process -FilePath $uninstallPreviewExe -ArgumentList "_?=$previewRoot" -WindowStyle Hidden -PassThru
    if (-not $uninstallPreviewProcess.WaitForExit(20000)) {
        $uninstallPreviewProcess.Kill()
        throw 'Uninstall preview timed out.'
    }
    if ($uninstallPreviewProcess.ExitCode -ne 0) { throw "Uninstall preview exited with code $($uninstallPreviewProcess.ExitCode)." }
    foreach ($pageName in @('uninstall', 'removing')) {
        $capturePath = Join-Path $captureRoot "$pageName-$languageId.bmp"
        if (-not (Test-Path -LiteralPath $capturePath) -or (Get-Item -LiteralPath $capturePath).LastWriteTimeUtc -lt $uninstallPreviewStarted) {
            throw "Missing or stale uninstall preview: $capturePath"
        }
        if (Select-String -LiteralPath "$capturePath.txt" -SimpleMatch 'CLIPPED_TEXT' -Quiet) {
            throw "Clipped text in $capturePath. Inspect its control log."
        }
    }
    Write-Output "Captured native installer pages: English, $Dpi DPI"
}
finally { $env:SHOT_PREVIEW_DPI = $previousPreviewDpi }
Write-Output "Preview files: $captureRoot"
