param(
    [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"
$PatchRoot = $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    if (Test-Path (Join-Path $PatchRoot ".git")) {
        $ProjectRoot = $PatchRoot
    } else {
        $ProjectRoot = Split-Path -Parent $PatchRoot
    }
}

$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
if (-not (Test-Path (Join-Path $ProjectRoot ".git"))) {
    throw "NEON LIFE git repository not found at $ProjectRoot"
}

$files = Get-Content (Join-Path $PatchRoot "PATCH_FILES.txt") |
    Where-Object { $_ -and $_ -ne "APPLY_PATCH.ps1" }

foreach ($relativePath in $files) {
    $source = Join-Path $PatchRoot $relativePath
    if (-not (Test-Path $source)) {
        throw "Patch file is missing: $relativePath"
    }

    $destination = Join-Path $ProjectRoot $relativePath
    $destinationDirectory = Split-Path -Parent $destination
    if ($destinationDirectory) {
        New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
    }
    Copy-Item -Force -Path $source -Destination $destination
}

Write-Host "NEON LIFE v0.29.0 VEHICLE THEFT & WITNESSES applied to $ProjectRoot"
