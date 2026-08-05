param(
  [Parameter(Mandatory = $false)]
  [string]$ProjectRoot = "C:\NeonLife",

  [Parameter(Mandatory = $false)]
  [switch]$RunChecks
)

$ErrorActionPreference = "Stop"
$PatchDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Manifest = Join-Path $PatchDir "PATCH_FILES.txt"
$DeleteManifest = Join-Path $PatchDir "DELETE_FILES.txt"

if (-not (Test-Path $ProjectRoot)) { throw "Project root not found: $ProjectRoot" }
if (-not (Test-Path (Join-Path $ProjectRoot "package.json"))) { throw "package.json not found in project root: $ProjectRoot" }
if (-not (Test-Path $Manifest)) { throw "PATCH_FILES.txt not found next to APPLY_PATCH.ps1" }

$packageJson = Get-Content (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
if ($packageJson.version -ne "0.49.0") { Write-Warning "Expected base version 0.49.0, found $($packageJson.version)." }

$files = Get-Content $Manifest | Where-Object {
  $_ -and -not $_.StartsWith("NEON LIFE") -and $_ -ne "APPLY_PATCH.ps1" -and $_ -ne "PATCH_FILES.txt" -and $_ -ne "DELETE_FILES.txt"
}
foreach ($relativePath in $files) {
  $source = Join-Path $PatchDir ($relativePath -replace "/", [IO.Path]::DirectorySeparatorChar)
  $target = Join-Path $ProjectRoot ($relativePath -replace "/", [IO.Path]::DirectorySeparatorChar)
  if (-not (Test-Path $source)) { throw "Patch file missing: $relativePath" }
  New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
  Copy-Item -Path $source -Destination $target -Force
}

if (Test-Path $DeleteManifest) {
  foreach ($relativePath in (Get-Content $DeleteManifest | Where-Object { $_ })) {
    $target = Join-Path $ProjectRoot ($relativePath -replace "/", [IO.Path]::DirectorySeparatorChar)
    if (Test-Path $target) { Remove-Item $target -Force }
  }
}

$updatedPackage = Get-Content (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
if ($updatedPackage.version -ne "0.50.0") { throw "Patch copied, but package.json version is $($updatedPackage.version), expected 0.50.0" }
Write-Host "NEON LIFE v0.50.0 SIMPLE PLAYER LOOP applied successfully." -ForegroundColor Green

if ($RunChecks) {
  Push-Location $ProjectRoot
  try { npm install; npm test; npm run build }
  finally { Pop-Location }
}
