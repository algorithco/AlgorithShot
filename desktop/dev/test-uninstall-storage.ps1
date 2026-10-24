param(
  [string]$MakeNsis = (Join-Path $env:LOCALAPPDATA 'tauri\NSIS\makensis.exe'),
  [string]$InstallerScript
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$testBase = [IO.Path]::GetFullPath((Join-Path $project 'src-tauri\target\storage-uninstall-tests'))
$fixtureRoot = Join-Path $testBase ([guid]::NewGuid().ToString())
if (-not $InstallerScript) {
  $InstallerScript = Join-Path $project 'src-tauri\windows\installer.nsi'
}

if (-not (Test-Path -LiteralPath $MakeNsis -PathType Leaf)) {
  throw 'NSIS is required. Build the Tauri installer first, or pass -MakeNsis with the path to makensis.exe.'
}

try {
  New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
  $metadata = @('settings.json', 'settings.json.tmp', 'library.db', 'library.db-wal', 'library.db-shm', 'library.db-journal')
  $userFiles = @(
    'Roaming\com.algorithco.shot\capture.png',
    'Roaming\com.algorithco.shot\originals\original.png',
    'Roaming\com.algorithco.shot\custom shots\capture.jpg',
    'Local\com.algorithco.shot\custom shots\capture.webp',
    'Local\com.algorithco.shot\thumbs\user-capture.png',
    'Pictures\AlgorithShot\capture.png',
    'Pictures\AlgorithShot\.originals\original.png'
  )
  $before = @{}
  foreach ($relative in $userFiles) {
    $path = Join-Path $fixtureRoot $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
    [IO.File]::WriteAllBytes($path, [Text.Encoding]::UTF8.GetBytes("user image: $relative"))
    $before[$relative] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
  }
  foreach ($dir in @('Roaming\com.algorithco.shot', 'Local\com.algorithco.shot')) {
    foreach ($file in $metadata) {
      [IO.File]::WriteAllText((Join-Path $fixtureRoot "$dir\$file"), 'replaceable metadata')
    }
  }

  $template = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $InstallerScript).Path)
  if ($template -match '(?im)^\s*RMDir\s+/r\b[^\r\n]*\$(?:LOCAL)?APPDATA') {
    throw 'The full uninstaller still recursively deletes an app-data folder.'
  }
  foreach ($call in @(
    '!insertmacro ShotDeleteSettingsAndIndex "$APPDATA\${BUNDLEID}"',
    '!insertmacro ShotDeleteSettingsAndIndex "$LOCALAPPDATA\${BUNDLEID}"'
  )) {
    if (-not $template.Contains($call)) {
      throw "The uninstaller does not use screenshot-preserving clean-up: $call"
    }
  }
  $macro = [regex]::Match($template, '(?ms)^!macro ShotDeleteSettingsAndIndex DIR\r?\n.*?^!macroend').Value
  if (-not $macro) { throw 'The screenshot-preserving uninstall macro is missing.' }
  $harness = @'
Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "__ROOT__\cleanup-test.exe"
__MACRO__
Section
  !insertmacro ShotDeleteSettingsAndIndex "__ROOT__\Roaming\com.algorithco.shot"
  !insertmacro ShotDeleteSettingsAndIndex "__ROOT__\Local\com.algorithco.shot"
SectionEnd
'@
  $script = Join-Path $fixtureRoot 'cleanup-test.nsi'
  [IO.File]::WriteAllText($script, $harness.Replace('__ROOT__', $fixtureRoot).Replace('__MACRO__', $macro))
  & $MakeNsis /V2 $script
  if ($LASTEXITCODE -ne 0) { throw "NSIS compilation failed: $LASTEXITCODE" }
  $process = Start-Process -FilePath (Join-Path $fixtureRoot 'cleanup-test.exe') -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Uninstall clean-up failed: $($process.ExitCode)" }

  foreach ($relative in $userFiles) {
    $path = Join-Path $fixtureRoot $relative
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Screenshot was deleted: $relative" }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $before[$relative]) { throw "Screenshot changed: $relative" }
  }
  foreach ($dir in @('Roaming\com.algorithco.shot', 'Local\com.algorithco.shot')) {
    foreach ($file in $metadata) {
      if (Test-Path -LiteralPath (Join-Path $fixtureRoot "$dir\$file")) { throw "Metadata was not cleared: $dir\$file" }
    }
  }
  Write-Output 'PASS: uninstall clean-up removed settings/index files and preserved all 7 images byte for byte.'
} finally {
  $resolvedRoot = [IO.Path]::GetFullPath($fixtureRoot)
  if (-not $resolvedRoot.StartsWith($testBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to remove a fixture outside the test directory.'
  }
  if (Test-Path -LiteralPath $resolvedRoot) {
    Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
  }
}
