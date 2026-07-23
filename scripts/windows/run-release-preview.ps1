[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$releaseExe = Join-Path $repoRoot "src-tauri\target\release\prompt-vault-app.exe"

Push-Location $repoRoot
try {
    Write-Host "Building the current Prompt Vault source as a release executable..." -ForegroundColor Cyan
    & pnpm tauri:build -- --no-bundle
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri release build failed with exit code $LASTEXITCODE."
    }

    if (-not (Test-Path -LiteralPath $releaseExe)) {
        throw "Release executable was not created: $releaseExe"
    }

    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $releaseExe).Hash.ToLowerInvariant()
    Write-Host "Launching release preview:" -ForegroundColor Green
    Write-Host "  $releaseExe"
    Write-Host "  SHA256: $hash"
    Write-Host "This is the current release binary, but it is not registered in Windows Installed Apps." -ForegroundColor Yellow

    Start-Process -FilePath $releaseExe
} finally {
    Pop-Location
}
