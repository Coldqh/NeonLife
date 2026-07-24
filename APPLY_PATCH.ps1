param(
    [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"
$PatchRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)

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
    Where-Object { $_ -and $_ -notin @("APPLY_PATCH.ps1", "PATCH_FILES.txt", "DELETE_FILES.txt") }

foreach ($relativePath in $files) {
    $source = [System.IO.Path]::GetFullPath((Join-Path $PatchRoot $relativePath))
    if (-not (Test-Path $source)) {
        throw "Patch file is missing: $relativePath"
    }

    $destination = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $relativePath))
    if ($source -eq $destination) {
        continue
    }

    $destinationDirectory = Split-Path -Parent $destination
    if ($destinationDirectory) {
        New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
    }
    Copy-Item -Force -Path $source -Destination $destination
}

$deleteList = Join-Path $PatchRoot "DELETE_FILES.txt"
if (Test-Path $deleteList) {
    Get-Content $deleteList | Where-Object { $_ } | ForEach-Object {
        $target = Join-Path $ProjectRoot $_
        if (Test-Path $target) {
            Remove-Item -Force -Recurse $target
        }
    }
}

@(
    "src/app/layout",
    "src/app/mobile",
    "src/app/workspaces"
) | ForEach-Object {
    $directory = Join-Path $ProjectRoot $_
    if ((Test-Path $directory) -and -not (Get-ChildItem -Force $directory)) {
        Remove-Item -Force $directory
    }
}

Write-Host "NEON LIFE v0.30.2 UNIFIED INTERFACE ARCHITECTURE applied to $ProjectRoot"
