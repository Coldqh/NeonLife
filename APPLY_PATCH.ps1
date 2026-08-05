param(
  [Parameter(Mandatory = $false)]
  [string]$ProjectRoot = "C:\NeonLife",
  [switch]$RunChecks
)

$ErrorActionPreference = "Stop"
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$FilesRoot = Join-Path $PSScriptRoot "files"
$DeleteManifest = Join-Path $PSScriptRoot "DELETE_FILES.txt"

if (-not (Test-Path (Join-Path $ProjectRoot ".git"))) {
  throw "Git repository not found: $ProjectRoot"
}
if (-not (Test-Path $FilesRoot)) {
  throw "Patch files directory not found: $FilesRoot"
}

Write-Host "Applying Neon Life 0.51.0 to $ProjectRoot"

Get-ChildItem -Path $FilesRoot -Recurse -File | ForEach-Object {
  $relative = $_.FullName.Substring($FilesRoot.Length).TrimStart('\', '/')
  $target = Join-Path $ProjectRoot $relative
  $parent = Split-Path $target -Parent
  if (-not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  Copy-Item -LiteralPath $_.FullName -Destination $target -Force
}

if (Test-Path $DeleteManifest) {
  Get-Content $DeleteManifest | ForEach-Object {
    $relative = $_.Trim()
    if (-not $relative) { return }
    & git -C $ProjectRoot rm --ignore-unmatch -- $relative 2>$null | Out-Null
    $target = Join-Path $ProjectRoot $relative
    if (Test-Path $target) {
      Remove-Item -LiteralPath $target -Recurse -Force
    }
  }
}

$forbidden = @(
  "src\app\map\VenueWorkPanel.tsx",
  "src\gameplay\jobs\work\workSystem.ts",
  "src\gameplay\jobs\work\types.ts",
  "src\gameplay\jobs\courier\courierSystem.ts"
)
foreach ($relative in $forbidden) {
  if (Test-Path (Join-Path $ProjectRoot $relative)) {
    throw "Legacy duplicate still exists: $relative"
  }
}

$workScreen = Get-Content (Join-Path $ProjectRoot "src\app\screens\WorkScreen.tsx") -Raw
foreach ($forbiddenToken in @("TRAINING_ACTIONS", "EQUIPMENT_CATALOG", "STREET_FIGHTS", "boxing-fight", "buy-equipment")) {
  if ($workScreen.Contains($forbiddenToken)) {
    throw "WorkScreen still contains a foreign system: $forbiddenToken"
  }
}

if ($RunChecks) {
  Push-Location $ProjectRoot
  try {
    npm ci
    npm run typecheck
    npm run test:legacy-work
    npm run test:work
    npm run test:ui
    npm run build
  }
  finally {
    Pop-Location
  }
}

Write-Host "Neon Life 0.51.0 applied successfully."
Write-Host "Review changes with: git -C $ProjectRoot status --short"
