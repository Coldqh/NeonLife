param(
  [Parameter(Mandatory = $false)]
  [string]$ProjectRoot = "C:\NeonLife",

  [Parameter(Mandatory = $false)]
  [switch]$RunChecks
)

$ErrorActionPreference = "Stop"
$PatchDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Manifest = Join-Path $PatchDir "PATCH_FILES.txt"

if (-not (Test-Path $ProjectRoot)) {
  throw "Project root not found: $ProjectRoot"
}
if (-not (Test-Path (Join-Path $ProjectRoot "package.json"))) {
  throw "package.json not found in project root: $ProjectRoot"
}
if (-not (Test-Path $Manifest)) {
  throw "PATCH_FILES.txt not found next to APPLY_PATCH.ps1"
}

$packageJson = Get-Content (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
if ($packageJson.version -ne "0.45.0") {
  Write-Warning "Expected base version 0.45.0, found $($packageJson.version)."
}

$files = Get-Content $Manifest | Where-Object {
  $_ -and -not $_.StartsWith("NEON LIFE") -and $_ -ne "APPLY_PATCH.ps1" -and $_ -ne "PATCH_FILES.txt"
}

$index = 0
foreach ($relativePath in $files) {
  $index += 1
  $source = Join-Path $PatchDir ($relativePath -replace "/", [IO.Path]::DirectorySeparatorChar)
  $target = Join-Path $ProjectRoot ($relativePath -replace "/", [IO.Path]::DirectorySeparatorChar)
  if (-not (Test-Path $source)) {
    throw "Patch file missing: $relativePath"
  }
  $targetDir = Split-Path -Parent $target
  New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
  Write-Host "[$index/$($files.Count)] $relativePath"
  Copy-Item -Path $source -Destination $target -Force
}

$updatedPackage = Get-Content (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
if ($updatedPackage.version -ne "0.46.0") {
  throw "Patch copied, but package.json version is $($updatedPackage.version), expected 0.46.0"
}

Write-Host "NEON LIFE v0.46.0 PLAYER LOOP & RUNTIME SPLIT applied successfully." -ForegroundColor Green

if ($RunChecks) {
  Push-Location $ProjectRoot
  try {
    npm install
    npm run typecheck
    npm run test
    npm run build
  }
  finally {
    Pop-Location
  }
}
