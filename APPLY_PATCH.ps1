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
if (-not (Test-Path (Join-Path $ProjectRoot "package.json"))) {
    throw "NEON LIFE project not found at $ProjectRoot"
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

$obsolete = @(
    "PATCH_0.10.0.md",
    "docs\CITY_SITUATIONS.md",
    "src\gameplay\situations\situationSystem.ts",
    "src\gameplay\situations\types.ts",
    "src\ui\components\SituationGate.tsx"
)

foreach ($relativePath in $obsolete) {
    $target = Join-Path $ProjectRoot $relativePath
    if (Test-Path $target) {
        Remove-Item -Force $target
    }
}

$situationsDirectory = Join-Path $ProjectRoot "src\gameplay\situations"
if ((Test-Path $situationsDirectory) -and -not (Get-ChildItem $situationsDirectory -Force)) {
    Remove-Item -Force $situationsDirectory
}

Write-Host "NEON LIFE v0.12.0 HOUSEHOLD ECONOMY applied to $ProjectRoot"
