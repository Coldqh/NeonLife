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
if (-not (Test-Path (Join-Path $ProjectRoot "package.json"))) {
  throw "package.json not found: $ProjectRoot"
}
if (-not (Test-Path $FilesRoot)) {
  throw "Patch payload not found: $FilesRoot"
}

Write-Host "Applying Neon Life 0.52.0 to $ProjectRoot"

Get-ChildItem -Path $FilesRoot -Recurse -File | ForEach-Object {
  $relative = $_.FullName.Substring($FilesRoot.Length).TrimStart('\', '/')
  $target = Join-Path $ProjectRoot $relative
  $parent = Split-Path $target -Parent
  if (-not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  Copy-Item -LiteralPath $_.FullName -Destination $target -Force
}

Get-Content $DeleteManifest | ForEach-Object {
  $relative = $_.Trim()
  if (-not $relative) { return }
  & git -C $ProjectRoot rm -r --ignore-unmatch -- $relative 2>$null | Out-Null
  $target = Join-Path $ProjectRoot ($relative -replace '/', [IO.Path]::DirectorySeparatorChar)
  if (Test-Path $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
}

$package = Get-Content (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
if ($package.version -ne "0.52.0") {
  throw "Wrong project version after patch: $($package.version)"
}

$work = Get-Content (Join-Path $ProjectRoot "src\app\screens\WorkScreen.tsx") -Raw
foreach ($token in @("TRAINING_ACTIONS", "EQUIPMENT_CATALOG", "STREET_FIGHTS", "boxing-fight", "buy-equipment")) {
  if ($work.Contains($token)) { throw "WorkScreen still contains foreign system: $token" }
}
if (-not $work.Contains("Физическая работа") -or -not $work.Contains("state.employment")) {
  throw "Contract-only physical WorkScreen was not installed"
}

$building = Get-Content (Join-Path $ProjectRoot "src\app\map\BuildingServicePanel.tsx") -Raw
if (-not $building.Contains("jobsForVenueCategory")) {
  throw "Physical venue vacancies were not installed"
}

$profile = Get-Content (Join-Path $ProjectRoot "src\app\screens\ProfileScreen.tsx") -Raw
foreach ($token in @("ХАРАКТЕРИСТИКИ", "СНАРЯЖЕНИЕ", "БИОГРАФИЯ")) {
  if (-not $profile.Contains($token)) { throw "Profile section missing: $token" }
}

if (Test-Path (Join-Path $ProjectRoot "files")) {
  throw "Accidental nested files payload still exists"
}
foreach ($legacy in @(
  "src\app\map\VenueWorkPanel.tsx",
  "src\gameplay\jobs\work\workSystem.ts",
  "src\gameplay\jobs\work\types.ts",
  "src\gameplay\jobs\courier\courierSystem.ts"
)) {
  if (Test-Path (Join-Path $ProjectRoot $legacy)) { throw "Legacy duplicate still exists: $legacy" }
}

if ($RunChecks) {
  Push-Location $ProjectRoot
  try {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
    npm run typecheck
    if ($LASTEXITCODE -ne 0) { throw "typecheck failed" }
    npm run test:ui
    if ($LASTEXITCODE -ne 0) { throw "UI tests failed" }
    npm run test:domain
    if ($LASTEXITCODE -ne 0) { throw "domain tests failed" }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "production build failed" }
  }
  finally {
    Pop-Location
  }
}

Write-Host "Neon Life 0.52.0 applied successfully." -ForegroundColor Green
Write-Host "Review changes: git -C $ProjectRoot status --short"
