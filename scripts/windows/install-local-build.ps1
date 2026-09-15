[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$ConfirmReinstall,
    [string]$MsiPath
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

if (-not $ConfirmReinstall) {
    throw "This script performs an uninstall-first clean local reinstall. Re-run only when that behavior is intended, using -ConfirmReinstall. For ordinary installed-build update work, follow issue #73 instead."
}

if ($SkipBuild -and [string]::IsNullOrWhiteSpace($MsiPath)) {
    throw "-SkipBuild requires an explicit -MsiPath. Timestamp-based package selection is not permitted."
}

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

function Resolve-ExplicitMsi([string]$candidatePath, [string]$allowedRoot) {
    $resolved = Resolve-Path -LiteralPath $candidatePath -ErrorAction Stop
    $item = Get-Item -LiteralPath $resolved.Path -ErrorAction Stop
    if (-not $item.PSIsContainer -and $item.Extension -ieq ".msi") {
        $rootFull = [IO.Path]::GetFullPath($allowedRoot).TrimEnd('\') + '\'
        $itemFull = [IO.Path]::GetFullPath($item.FullName)
        if ($itemFull.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
            return $item
        }
    }

    throw "The selected MSI must be one explicit .msi file contained under $allowedRoot."
}

function Stop-RegisteredPromptVaultProcess([object]$installRecord) {
    $running = @(Get-Process -Name "prompt-vault-app" -ErrorAction SilentlyContinue)
    if ($running.Count -eq 0) {
        return
    }

    $installLocation = [string]$installRecord.InstallLocation
    if ([string]::IsNullOrWhiteSpace($installLocation)) {
        throw "Prompt Vault is running, but the registered install location is unavailable. Close the installed app manually and rerun the explicit clean reinstall."
    }

    $installRoot = [IO.Path]::GetFullPath($installLocation).TrimEnd('\') + '\'
    foreach ($process in $running) {
        try {
            $processPath = [IO.Path]::GetFullPath([string]$process.Path)
        } catch {
            throw "A prompt-vault-app process is running, but its executable path could not be verified. Close it manually and rerun."
        }

        if (-not $processPath.StartsWith($installRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw "A prompt-vault-app process is running outside the registered Prompt Vault install location. Refusing to stop an unverified process."
        }
    }

    $running | Stop-Process -Force
}

Push-Location $repoRoot
try {
    Write-Host "Prompt Vault explicit clean local reinstall" -ForegroundColor Cyan
    Write-Host "Publisher metadata: Nobody Production"
    Write-Host "Trust status: unsigned local development package" -ForegroundColor Yellow
    Write-Host "Windows may display 'Unknown publisher' until trusted production code signing is configured." -ForegroundColor Yellow
    Write-Host "WARNING: this is not an in-place updater." -ForegroundColor Yellow
    Write-Host "It may force-close the verified installed prompt-vault-app process and uninstalls the currently registered Prompt Vault MSI before installing the selected local build." -ForegroundColor Yellow
    Write-Host "The workflow is intended only for an explicitly requested clean local reinstall and preserves the normal Prompt Vault database path." -ForegroundColor Yellow
    Write-Host ""

    if (-not $SkipBuild) {
        Write-Host "Building fresh MSI and NSIS packages from the current branch..." -ForegroundColor Cyan
        & pnpm tauri:build
        if ($LASTEXITCODE -ne 0) {
            throw "Tauri package build failed with exit code $LASTEXITCODE."
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($MsiPath)) {
        $msi = Resolve-ExplicitMsi -candidatePath $MsiPath -allowedRoot $bundleRoot
    } else {
        $packageJson = Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
        $currentVersion = [string]$packageJson.version
        if ([string]::IsNullOrWhiteSpace($currentVersion)) {
            throw "Current application version could not be read from package.json."
        }

        $candidates = @(Get-ChildItem -LiteralPath $bundleRoot -Filter "Prompt Vault_$currentVersion*.msi" -File -ErrorAction Stop)
        if ($candidates.Count -ne 1) {
            throw "Expected exactly one MSI for application version $currentVersion under $bundleRoot, but found $($candidates.Count). Select one explicitly with -MsiPath."
        }
        $msi = $candidates[0]
    }

    $signature = Get-AuthenticodeSignature -LiteralPath $msi.FullName
    $signatureLabel = if ($signature.SignerCertificate) {
        $signature.SignerCertificate.Subject
    } else {
        "No trusted signer attached"
    }
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $msi.FullName).Hash.ToLowerInvariant()

    Write-Host "Clean reinstall package candidate:" -ForegroundColor Cyan
    Write-Host "  Package: $($msi.FullName)"
    Write-Host "  Manufacturer metadata: Nobody Production"
    Write-Host "  Signature status: $($signature.Status)"
    Write-Host "  Signer: $signatureLabel"
    Write-Host "  SHA256: $hash"

    $installedRecords = @(Get-PromptVaultInstall)
    if ($installedRecords.Count -gt 1) {
        throw "Multiple Prompt Vault uninstall registrations were found. Refusing to guess which installation should be removed."
    }

    $installed = $installedRecords | Select-Object -First 1
    if ($installed) {
        $productCode = Get-MsiProductCode $installed
        if (-not $productCode) {
            throw "Prompt Vault is installed, but its MSI product code could not be determined safely. Uninstall it from Windows Installed Apps, then rerun this explicit clean reinstall command."
        }

        Stop-RegisteredPromptVaultProcess -installRecord $installed

        Write-Host "Explicit clean reinstall: uninstalling the previously installed local Prompt Vault MSI..." -ForegroundColor Cyan
        $uninstall = Start-Process -FilePath "msiexec.exe" `
            -ArgumentList "/x $productCode /passive /norestart" `
            -Wait `
            -PassThru

        if ($uninstall.ExitCode -notin 0, 3010) {
            throw "Windows Installer uninstall failed with exit code $($uninstall.ExitCode)."
        }
    }

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

    Write-Host "Prompt Vault clean local reinstall completed successfully." -ForegroundColor Green
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
        Write-Warning "The clean reinstall completed, but a Prompt Vault Start-menu shortcut was not located automatically."
    }

    $schemaChanges = git status --short -- src-tauri/gen/schemas
    if ($schemaChanges) {
        Write-Warning "Tauri regenerated tracked schema files during the build. Review or restore them before committing unrelated work."
        $schemaChanges | Write-Host
    }
} finally {
    Pop-Location
}
