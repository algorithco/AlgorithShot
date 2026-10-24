# NSIS is x86, including when it installs an x64 or ARM64 application.
# Build the tiny UI plug-in with the same MSVC tools required by Tauri.
param([switch]$Preview)
$ErrorActionPreference = 'Stop'
$uiRepo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$uiSource = Join-Path $uiRepo 'src-tauri/windows/native'
$uiOutput = Join-Path $uiRepo 'src-tauri/target/installer-ui/x86'
if ($Preview) { $uiOutput = Join-Path $uiRepo 'dev/installer-qa.local/native' }
New-Item -ItemType Directory -Path $uiOutput -Force | Out-Null
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) {
    throw 'Visual Studio C++ build tools are required for the installer UI.'
}
$visualStudio = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $visualStudio) { throw 'The MSVC x86/x64 build tools were not found.' }
$vcvars = Join-Path $visualStudio 'VC/Auxiliary/Build/vcvarsall.bat'
$uiDll = Join-Path $uiOutput 'ShotUI.dll'
$uiObject = Join-Path $uiOutput 'ShotUI.obj'
$uiLibrary = Join-Path $uiOutput 'ShotUI.lib'
$uiCommand = 'call "' + $vcvars + '" x86 >nul && cl /nologo /std:c++17 /O1 /MT /W4 /WX /EHsc /LD /DUNICODE /D_UNICODE "' +
    (Join-Path $uiSource 'ShotUI.cpp') + '" /Fo"' + $uiObject + '" /link user32.lib gdi32.lib comctl32.lib uxtheme.lib /DEF:"' +
    (Join-Path $uiSource 'ShotUI.def') + '" /OUT:"' + $uiDll + '" /IMPLIB:"' + $uiLibrary + '"'
if ($Preview) { $uiCommand = $uiCommand.Replace('/DUNICODE', '/DSHOT_UI_PREVIEW /DUNICODE') }
& $env:ComSpec /d /s /c $uiCommand
if ($LASTEXITCODE -ne 0) { throw 'The installer UI plug-in failed to compile.' }
Write-Output "Installer UI built: $uiDll"
