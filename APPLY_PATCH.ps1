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

$packageJson = Get-Content (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
if ($packageJson.version -ne "0.50.0") {
  Write-Warning "Expected base version 0.50.0, found $($packageJson.version). Hotfix will still remove legacy work files."
}

foreach ($relativePath in (Get-Content $Manifest | Where-Object { $_ })) {
  $normalized = $relativePath -replace "/", [IO.Path]::DirectorySeparatorChar
  $source = Join-Path $PatchDir $normalized
  $target = Join-Path $ProjectRoot $normalized
  if (-not (Test-Path $source)) { throw "Patch file missing: $relativePath" }
  New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
  Copy-Item -Path $source -Destination $target -Force
}

foreach ($relativePath in (Get-Content $DeleteManifest | Where-Object { $_ })) {
  $target = Join-Path $ProjectRoot ($relativePath -replace "/", [IO.Path]::DirectorySeparatorChar)
  if (Test-Path $target) {
    Remove-Item -Path $target -Force
    Write-Host "Deleted legacy file: $relativePath"
  }
}

$orphan = Join-Path $ProjectRoot "src\app\map\VenueWorkPanel.tsx"
if (Test-Path $orphan) { throw "Legacy VenueWorkPanel.tsx still exists after cleanup." }

$updatedPackage = Get-Content (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
if ($updatedPackage.version -ne "0.50.1") {
  throw "Patch copied, but package.json version is $($updatedPackage.version), expected 0.50.1"
}

Write-Host "NEON LIFE v0.50.1 legacy work cleanup applied." -ForegroundColor Green

if ($RunChecks) {
  Push-Location $ProjectRoot
  try {
    npm run test:legacy-work
    npm run typecheck
  }
  finally {
    Pop-Location
  }
}
