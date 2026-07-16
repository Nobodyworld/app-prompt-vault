[CmdletBinding()]
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$bundleRoot = Join-Path $repoRoot "src-tauri\target\release\bundle\msi"
$dataPath = Join-Path $env:LOCALAPPDATA "com.nobodyworld.promptvault\prompt-vault.db"

function Get-PromptVaultInstall {
    $roots = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )

    foreach ($root in $roots) {
        Get-ItemProperty -Path $root -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -eq "Prompt Vault" }
    }
}

function Get-MsiProductCode([object]$installRecord) {
    if ($installRecord.PSChildName -match '^\{[0-9A-Fa-f-]{36}\}$') {
        return $installRecord.PSChildName
    }

    $uninstallString = [string]$installRecord.UninstallString
    $match = [regex]::Match($uninstallString, '\{[0-9A-Fa-f-]{36}\}')
    if ($match.Success) {
        return $match.Value
    }

    return $null
}

Push-Location $repoRoot
try {
    Write-Host "Prompt Vault local desktop refresh" -ForegroundColor Cyan
    Write-Host "Publisher metadata: Nobody Production"
    Write-Host "Trust status: unsigned local development package" -ForegroundColor Yellow
    Write-Host "Windows may display 'Unknown publisher' until trusted production code signing is configured." -ForegroundColor Yellow
    Write-Host "This workflow preserves the local Prompt Vault database." -ForegroundColor Yellow
    Write-Host ""

    if (-not $SkipBuild) {
        Write-Host "Building fresh MSI and NSIS packages from the current branch..." -ForegroundColor Cyan
        & pnpm tauri:build
        if ($LASTEXITCODE -ne 0) {
            throw "Tauri package build failed with exit code $LASTEXITCODE."
        }
    }

    $msi = Get-ChildItem -LiteralPath $bundleRoot -Filter "Prompt Vault_*.msi" -File -ErrorAction Stop |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1

    if (-not $msi) {
        throw "No Prompt Vault MSI was found under $bundleRoot."
    }

    $signature = Get-AuthenticodeSignature -LiteralPath $msi.FullName
    $signatureLabel = if ($signature.SignerCertificate) {
        $signature.SignerCertificate.Subject
    } else {
        "No trusted signer attached"
    }

    Get-Process -Name "prompt-vault-app" -ErrorAction SilentlyContinue |
        Stop-Process -Force

    $installed = @(Get-PromptVaultInstall) | Select-Object -First 1
    if ($installed) {
        $productCode = Get-MsiProductCode $installed
        if (-not $productCode) {
            throw "Prompt Vault is installed, but its MSI product code could not be determined safely. Uninstall it from Windows Installed Apps, then rerun this command."
        }

        Write-Host "Replacing the previously installed local Prompt Vault build..." -ForegroundColor Cyan
        $uninstall = Start-Process -FilePath "msiexec.exe" `
            -ArgumentList "/x $productCode /passive /norestart" `
            -Wait `
            -PassThru

        if ($uninstall.ExitCode -notin 0, 3010) {
            throw "Windows Installer uninstall failed with exit code $($uninstall.ExitCode)."
        }
    }

    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $msi.FullName).Hash.ToLowerInvariant()
    Write-Host "Installing the current local Prompt Vault build:" -ForegroundColor Green
    Write-Host "  Package: $($msi.FullName)"
    Write-Host "  Manufacturer metadata: Nobody Production"
    Write-Host "  Signature status: $($signature.Status)"
    Write-Host "  Signer: $signatureLabel"
    Write-Host "  SHA256: $hash"

    $install = Start-Process -FilePath "msiexec.exe" `
        -ArgumentList "/i `"$($msi.FullName)`" /passive /norestart" `
        -Wait `
        -PassThru

    if ($install.ExitCode -notin 0, 3010) {
        throw "Windows Installer install failed with exit code $($install.ExitCode)."
    }

    Write-Host "Installed Prompt Vault was refreshed successfully." -ForegroundColor Green
    Write-Host "User data was not removed. Expected database path:" -ForegroundColor Yellow
    Write-Host "  $dataPath"

    $shortcutRoots = @(
        (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"),
        (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs")
    )

    $shortcut = Get-ChildItem -Path $shortcutRoots -Filter "Prompt Vault*.lnk" -File -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1

    if ($shortcut) {
        Start-Process -FilePath $shortcut.FullName
    } else {
        Write-Warning "The install completed, but a Prompt Vault Start-menu shortcut was not located automatically."
    }

    $schemaChanges = git status --short -- src-tauri/gen/schemas
    if ($schemaChanges) {
        Write-Warning "Tauri regenerated tracked schema files during the build. Review or restore them before committing unrelated work."
        $schemaChanges | Write-Host
    }
} finally {
    Pop-Location
}
