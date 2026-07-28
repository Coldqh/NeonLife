param(
  [Parameter(Mandatory = $false)]
  [string]$ProjectRoot = "C:\NeonLife",

  [Parameter(Mandatory = $false)]
  [switch]$RunChecks
)

$ErrorActionPreference = "Stop"
$Commit = "7c473705b49a5716390203ccac310ecaebdb892b"
$RepoRaw = "https://raw.githubusercontent.com/Coldqh/NeonLife/$Commit"
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
if ($packageJson.version -ne "0.32.1" -and $packageJson.version -ne "0.33.0") {
  Write-Warning "Expected base version 0.32.1, found $($packageJson.version). Continuing because the patch is commit-pinned."
}

$files = Get-Content $Manifest | Where-Object {
  $_ -and $_ -ne "APPLY_PATCH.ps1" -and $_ -ne "PATCH_FILES.txt"
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("NeonLife-0.33.0-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
  $index = 0
  foreach ($relativePath in $files) {
    $index += 1
    $urlPath = ($relativePath -split "/" | ForEach-Object { [uri]::EscapeDataString($_) }) -join "/"
    $url = "$RepoRaw/$urlPath"
    $tempFile = Join-Path $tempRoot ($relativePath -replace "/", [IO.Path]::DirectorySeparatorChar)
    $tempDir = Split-Path -Parent $tempFile
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    Write-Host "[$index/$($files.Count)] Downloading $relativePath"
    Invoke-WebRequest -Uri $url -OutFile $tempFile -UseBasicParsing
    if (-not (Test-Path $tempFile) -or (Get-Item $tempFile).Length -eq 0) {
      throw "Downloaded file is empty: $relativePath"
    }
  }

  foreach ($relativePath in $files) {
    $source = Join-Path $tempRoot ($relativePath -replace "/", [IO.Path]::DirectorySeparatorChar)
    $target = Join-Path $ProjectRoot ($relativePath -replace "/", [IO.Path]::DirectorySeparatorChar)
    $targetDir = Split-Path -Parent $target
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    Copy-Item -Path $source -Destination $target -Force
  }

  $updatedPackage = Get-Content (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
  if ($updatedPackage.version -ne "0.33.0") {
    throw "Patch copied, but package.json version is $($updatedPackage.version), expected 0.33.0"
  }

  Write-Host "NEON LIFE v0.33.0 LOCAL MOVEMENT & ROUTE PLANNER applied successfully." -ForegroundColor Green
  Write-Host "Pinned source commit: $Commit"

  if ($RunChecks) {
    Push-Location $ProjectRoot
    try {
      npm install
      npm run build
      npm run test:movement
      npm run test:ui
    }
    finally {
      Pop-Location
    }
  }
}
finally {
  if (Test-Path $tempRoot) {
    Remove-Item -Path $tempRoot -Recurse -Force
  }
}
