[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$PreflightOnly,
    [switch]$PrepareElevation,
    [switch]$RequestElevation,
    [switch]$ExecuteContinuation,
    [string]$EvidencePath,
    [string]$ContinuationManifest,
    [string]$ExpectedManifestSha256,
    [ValidateRange(30, 3600)][int]$MsiTimeoutSeconds = 900,
    [ValidateRange(5, 300)][int]$CloseTimeoutSeconds = 30,
    [switch]$LaunchAfterInstall
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
Set-StrictMode -Version Latest

if ($env:OS -ne "Windows_NT") { throw "The installed Prompt Vault refresh is Windows-only." }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$scriptPath = $PSCommandPath
$bundleRoot = Join-Path $repoRoot "src-tauri\target\release\bundle\msi"
$candidateExecutablePath = Join-Path $repoRoot "src-tauri\target\release\prompt-vault-app.exe"
$candidateReceiptPath = Join-Path $bundleRoot "prompt-vault-msi-refresh-candidate.v1.private.json"
$coreModule = Join-Path $PSScriptRoot "install-local-build-core.psm1"
Import-Module $coreModule -Force

$selectedModes = @(@($PreflightOnly, $PrepareElevation, $RequestElevation, $ExecuteContinuation) | Where-Object { $_ })
if ($selectedModes.Count -gt 1) { throw "Choose only one of -PreflightOnly, -PrepareElevation, -RequestElevation, or -ExecuteContinuation." }
if (($RequestElevation -or $ExecuteContinuation) -and ([string]::IsNullOrWhiteSpace($ContinuationManifest) -or [string]::IsNullOrWhiteSpace($ExpectedManifestSha256))) {
    throw "Elevation continuation requires -ContinuationManifest and -ExpectedManifestSha256."
}
if ($PrepareElevation -and [string]::IsNullOrWhiteSpace($EvidencePath)) { throw "-PrepareElevation requires an explicit fresh -EvidencePath beneath C:\tmp." }
if ($LaunchAfterInstall -and ($PreflightOnly -or $PrepareElevation -or $RequestElevation)) { throw "-LaunchAfterInstall is valid only inside the installing process." }

function Write-JsonFile([string]$Path, $Value, [int]$Depth = 10) {
    $Value | ConvertTo-Json -Depth $Depth | Set-Content -LiteralPath $Path -Encoding utf8
}

function Get-ObjectPropertyValue($InputObject, [string]$Name) {
    $property = $InputObject.PSObject.Properties[$Name]
    if ($property) { return $property.Value }
    return $null
}

function Get-PromptVaultInstallRecords {
    $roots = @(
        [pscustomobject]@{ Path = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*"; Scope = "PerUser"; Hive = "HKCU"; View = "native" },
        [pscustomobject]@{ Path = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*"; Scope = "PerMachine"; Hive = "HKLM"; View = "native" },
        [pscustomobject]@{ Path = "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"; Scope = "PerMachine"; Hive = "HKLM"; View = "WOW6432Node" }
    )
    $records = [System.Collections.Generic.List[object]]::new()
    foreach ($root in $roots) {
        foreach ($record in @(Get-ItemProperty -Path $root.Path -ErrorAction SilentlyContinue | Where-Object { [string](Get-ObjectPropertyValue $_ "DisplayName") -eq "Prompt Vault" })) {
            $records.Add([pscustomobject]@{
                DisplayName = [string](Get-ObjectPropertyValue $record "DisplayName")
                DisplayVersion = [string](Get-ObjectPropertyValue $record "DisplayVersion")
                Publisher = [string](Get-ObjectPropertyValue $record "Publisher")
                PSChildName = [string](Get-ObjectPropertyValue $record "PSChildName")
                UninstallString = [string](Get-ObjectPropertyValue $record "UninstallString")
                QuietUninstallString = [string](Get-ObjectPropertyValue $record "QuietUninstallString")
                InstallLocation = [string](Get-ObjectPropertyValue $record "InstallLocation")
                DisplayIcon = [string](Get-ObjectPropertyValue $record "DisplayIcon")
                RegistryPath = [string](Get-ObjectPropertyValue $record "PSPath")
                Scope = $root.Scope
                Hive = $root.Hive
                View = $root.View
            })
        }
    }
    return @($records)
}

function Test-CurrentProcessElevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-ActiveWindowsInstallerTransaction {
    $mutex = $null
    try {
        $mutex = [Threading.Mutex]::OpenExisting("Global\_MSIExecute")
        try {
            if ($mutex.WaitOne(0)) {
                $mutex.ReleaseMutex()
                return $false
            }
            return $true
        } catch [Threading.AbandonedMutexException] {
            try { $mutex.ReleaseMutex() } catch { }
            return $false
        }
    } catch [Threading.WaitHandleCannotBeOpenedException] {
        return $false
    } catch [UnauthorizedAccessException] {
        return $true
    } finally {
        if ($mutex) { $mutex.Dispose() }
    }
}

function Get-ArtifactInfo([string]$Path, [switch]$IncludeSignature) {
    $item = Get-Item -LiteralPath $Path -ErrorAction Stop
    $result = [ordered]@{
        path = $item.FullName
        name = $item.Name
        size = [long]$item.Length
        sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash
    }
    if ($IncludeSignature) {
        $signature = Get-AuthenticodeSignature -LiteralPath $item.FullName
        $result.signatureStatus = [string]$signature.Status
        $result.signer = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { "No trusted signer attached" }
    }
    return [pscustomobject]$result
}

function Get-RawCandidateArtifacts([switch]$AllowMissing) {
    $packages = @()
    if (Test-Path -LiteralPath $bundleRoot -PathType Container) {
        $packages = @(Get-ChildItem -LiteralPath $bundleRoot -Filter "Prompt Vault_*.msi" -File -ErrorAction Stop)
    }
    $executableExists = Test-Path -LiteralPath $candidateExecutablePath -PathType Leaf
    if ($packages.Count -gt 1) { throw "Multiple Prompt Vault MSI candidates exist; remove ambiguity before continuing." }
    if ($packages.Count -ne 1 -or -not $executableExists) {
        if ($AllowMissing) { return [pscustomobject]@{ Available = $false; Status = "missing"; Msi = $null; Executable = $null } }
        throw "Exactly one candidate MSI and the built release prompt-vault-app.exe are required."
    }
    return [pscustomobject]@{
        Available = $true
        Status = "unverified-pair"
        Msi = Get-ArtifactInfo $packages[0].FullName -IncludeSignature
        Executable = Get-ArtifactInfo $candidateExecutablePath
    }
}

function Get-CandidateArtifacts([switch]$AllowMissing) {
    $artifacts = Get-RawCandidateArtifacts -AllowMissing:$AllowMissing
    if (-not $artifacts.Available) { return $artifacts }
    if (-not (Test-Path -LiteralPath $candidateReceiptPath -PathType Leaf)) {
        if ($AllowMissing) { return [pscustomobject]@{ Available = $false; Status = "missing-msi-only-receipt"; Msi = $null; Executable = $null } }
        throw "The MSI and release executable lack an MSI-only pairing receipt; rebuild without -SkipBuild."
    }
    try {
        $receipt = Get-Content -LiteralPath $candidateReceiptPath -Raw | ConvertFrom-Json -Depth 10
        Test-CandidateReceiptData $receipt $artifacts.Msi $artifacts.Executable | Out-Null
    } catch {
        if ($AllowMissing) { return [pscustomobject]@{ Available = $false; Status = "stale-msi-only-receipt"; Msi = $null; Executable = $null } }
        throw "The MSI and release executable do not match their MSI-only build receipt; rebuild without -SkipBuild. $($_.Exception.Message)"
    }
    $artifacts.Status = "verified-msi-only-pair"
    return $artifacts
}

function Get-InstalledExecutableInfo($Registration, [switch]$AllowMissing) {
    if (-not $Registration.Found) {
        if ($AllowMissing) { return $null }
        throw "No installed Prompt Vault registration was found; this refresh command does not perform a first installation."
    }
    $record = $Registration.Record
    $candidates = [System.Collections.Generic.List[string]]::new()
    if (-not [string]::IsNullOrWhiteSpace($record.InstallLocation)) {
        $installLocation = [Environment]::ExpandEnvironmentVariables(([string]$record.InstallLocation).Trim().Trim('"'))
        $candidates.Add((Join-Path $installLocation "prompt-vault-app.exe"))
    }
    $displayIconPath = Get-DisplayIconExecutablePath ([string]$record.DisplayIcon)
    if ($displayIconPath) { $candidates.Add($displayIconPath) }
    $existing = @($candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | ForEach-Object { (Get-Item -LiteralPath $_).FullName } | Sort-Object -Unique)
    if ($existing.Count -gt 1) { throw "Installed Prompt Vault executable identity is ambiguous." }
    if ($existing.Count -ne 1) {
        if ($AllowMissing) { return $null }
        throw "The installed prompt-vault-app.exe could not be resolved from the single registration."
    }
    return Get-ArtifactInfo $existing[0]
}

function Get-ProtectedPathMap {
    return [ordered]@{
        "current-db" = Join-Path $env:LOCALAPPDATA "com.nobodyworld.promptvault\prompt-vault.db"
        "current-wal" = Join-Path $env:LOCALAPPDATA "com.nobodyworld.promptvault\prompt-vault.db-wal"
        "current-shm" = Join-Path $env:LOCALAPPDATA "com.nobodyworld.promptvault\prompt-vault.db-shm"
        "historical-db" = Join-Path $env:LOCALAPPDATA "com.promptvault.desktop\prompt-vault.db"
        "historical-wal" = Join-Path $env:LOCALAPPDATA "com.promptvault.desktop\prompt-vault.db-wal"
        "historical-shm" = Join-Path $env:LOCALAPPDATA "com.promptvault.desktop\prompt-vault.db-shm"
    }
}

function Get-FileInventory([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return [pscustomobject]@{ exists = $false; size = $null; lastWriteTimeUtc = $null; sha256 = $null } }
    $item = Get-Item -LiteralPath $Path -ErrorAction Stop
    return [pscustomobject]@{ exists = $true; size = [long]$item.Length; lastWriteTimeUtc = $item.LastWriteTimeUtc.ToString("o"); sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }
}

function Get-ProtectedInventory {
    $result = [ordered]@{}
    foreach ($entry in (Get-ProtectedPathMap).GetEnumerator()) { $result[$entry.Key] = Get-FileInventory $entry.Value }
    return [pscustomobject]$result
}

function Test-ReparsePath([string]$Path) {
    $cursor = $Path
    while ($cursor -and -not (Test-Path -LiteralPath $cursor)) { $cursor = Split-Path -Parent $cursor }
    while ($cursor) {
        $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $true }
        $parent = Split-Path -Parent $cursor
        if (-not $parent -or $parent -eq $cursor) { break }
        $cursor = $parent
    }
    return $false
}

function Initialize-EvidenceRoot([string]$Path) {
    $exists = Test-Path -LiteralPath $Path
    $canonical = Assert-EvidencePathContract $Path $repoRoot $exists (Test-ReparsePath $Path)
    New-Item -ItemType Directory -Path $canonical -ErrorAction Stop | Out-Null
    return $canonical
}

function Assert-ExistingEvidenceRoot([string]$Path) {
    $exists = Test-Path -LiteralPath $Path -PathType Container
    return Assert-EvidencePathContract $Path $repoRoot $exists (Test-ReparsePath $Path) -AllowExisting
}

function Get-RecommendedEvidencePath {
    return "C:\tmp\prompt-vault-msi-refresh-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))-$([Guid]::NewGuid().ToString('N').Substring(0,8))"
}

function Get-ProcessIdentity($Process) {
    try { $path = [string]$Process.Path } catch { throw "Could not resolve the executable path for prompt-vault-app process $($Process.Id); graceful close is ambiguous." }
    if ([string]::IsNullOrWhiteSpace($path)) { throw "Could not resolve the executable path for prompt-vault-app process $($Process.Id); graceful close is ambiguous." }
    $canonicalPath = ConvertTo-CanonicalWindowsPath ([IO.Path]::GetFullPath($path)) "Running process executable path"
    return [pscustomobject]@{ Id = [int]$Process.Id; StartTimeUtc = $Process.StartTime.ToUniversalTime().ToString("o"); Path = $canonicalPath; Native = $Process }
}

function Get-RunningPromptVaultProcesses([string]$ExpectedExecutablePath = "") {
    $records = @(Get-Process -Name "prompt-vault-app" -ErrorAction SilentlyContinue | ForEach-Object { Get-ProcessIdentity $_ })
    if (-not [string]::IsNullOrWhiteSpace($ExpectedExecutablePath)) {
        foreach ($record in $records) { Assert-ProcessExecutablePath $ExpectedExecutablePath $record.Path | Out-Null }
    }
    return $records
}

function Close-PromptVaultGracefully([int]$TimeoutSeconds, [string]$ExpectedExecutablePath) {
    $processes = Get-RunningPromptVaultProcesses $ExpectedExecutablePath
    $close = {
        param($record)
        $current = Get-Process -Id $record.Id -ErrorAction SilentlyContinue
        if (-not $current) { return $true }
        Assert-ProcessIdentity $record (Get-ProcessIdentity $current) | Out-Null
        return $current.CloseMainWindow()
    }
    $wait = {
        param($record)
        return $record.Native.WaitForExit($TimeoutSeconds * 1000)
    }.GetNewClosure()
    return Invoke-GracefulPromptVaultClose -Processes $processes -CloseAction $close -WaitAction $wait
}

function Assert-ArtifactMatches($Expected, [string]$Name) {
    $current = Get-ArtifactInfo $Expected.path
    Assert-ExecutableIdentity $Expected.sha256 $current.sha256 $Name | Out-Null
    if ([long]$Expected.size -ne [long]$current.size) { throw "$Name size changed after review." }
    return $current
}

function Read-PrivateLog([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return "" }
    return Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
}

function Invoke-MsiOperation([ValidateSet("Uninstall", "Install")][string]$Operation, [string]$Operand, [string]$LogPath, [int]$TimeoutSeconds) {
    $arguments = if ($Operation -eq "Uninstall") {
        "/x $Operand /passive /norestart /L*V `"$LogPath`""
    } else {
        "/i `"$Operand`" /passive /norestart /L*V `"$LogPath`""
    }
    $process = Start-Process -FilePath "msiexec.exe" -ArgumentList $arguments -PassThru
    $wait = { param($candidate, $seconds) $candidate.WaitForExit($seconds * 1000) }
    $exitCode = Wait-MsiProcessBounded -Process $process -TimeoutSeconds $TimeoutSeconds -WaitAction $wait
    $disposition = Get-MsiExitDisposition -Operation $Operation -ExitCode $exitCode -LogText (Read-PrivateLog $LogPath)
    return [pscustomobject]@{ Operation = $Operation; ExitCode = $exitCode; Success = $disposition.Success; Category = $disposition.Category; RebootRequired = $disposition.RebootRequired; Message = $disposition.Message; LogPath = $LogPath }
}

function ConvertTo-SafeError([string]$Message, [string]$EvidenceRoot = "") {
    $safe = $Message
    foreach ($value in @($repoRoot, $EvidenceRoot, $env:USERPROFILE, $env:LOCALAPPDATA)) {
        if (-not [string]::IsNullOrWhiteSpace($value)) { $safe = $safe.Replace($value, "<redacted-path>", [StringComparison]::OrdinalIgnoreCase) }
    }
    return $safe
}

function Get-Preflight([switch]$RequireArtifacts) {
    $registration = Resolve-PromptVaultRegistration (Get-PromptVaultInstallRecords)
    $elevated = Test-CurrentProcessElevated
    $elevation = Get-ElevationDisposition $registration.Scope $elevated
    $artifacts = if ($RequireArtifacts) { Get-CandidateArtifacts } else { Get-CandidateArtifacts -AllowMissing }
    $installed = if ($RequireArtifacts) { Get-InstalledExecutableInfo $registration } else { Get-InstalledExecutableInfo $registration -AllowMissing }
    $hashMatch = $null
    if ($installed -and $artifacts.Available) { $hashMatch = $installed.sha256 -eq $artifacts.Executable.sha256 }
    return [pscustomobject]@{
        Registration = $registration
        IsElevated = $elevated
        Elevation = $elevation
        ActiveInstallerTransaction = Test-ActiveWindowsInstallerTransaction
        RunningPromptVaultProcesses = @(Get-RunningPromptVaultProcesses $(if ($installed) { $installed.path } else { "" }))
        Artifacts = $artifacts
        InstalledExecutable = $installed
        InstalledMatchesCandidate = $hashMatch
    }
}

function Get-SafePreflight($Preflight, [string]$OwnerCommand) {
    return [ordered]@{
        version = 1
        mode = "non-mutating-preflight"
        registrationFound = [bool]$Preflight.Registration.Found
        installationScope = [string]$Preflight.Registration.Scope
        productCode = $Preflight.Registration.ProductCode
        processElevated = [bool]$Preflight.IsElevated
        elevationRequired = [bool]$Preflight.Elevation.ElevationRequired
        activeInstallerTransaction = [bool]$Preflight.ActiveInstallerTransaction
        runningPromptVaultProcessCount = @($Preflight.RunningPromptVaultProcesses).Count
        candidateAvailable = [bool]$Preflight.Artifacts.Available
        candidateStatus = [string]$Preflight.Artifacts.Status
        candidateMsi = if ($Preflight.Artifacts.Available) { [ordered]@{ name = $Preflight.Artifacts.Msi.name; size = $Preflight.Artifacts.Msi.size; sha256 = $Preflight.Artifacts.Msi.sha256; signatureStatus = $Preflight.Artifacts.Msi.signatureStatus } } else { $null }
        candidateExecutable = if ($Preflight.Artifacts.Available) { [ordered]@{ name = $Preflight.Artifacts.Executable.name; size = $Preflight.Artifacts.Executable.size; sha256 = $Preflight.Artifacts.Executable.sha256 } } else { $null }
        installedExecutable = if ($Preflight.InstalledExecutable) { [ordered]@{ name = $Preflight.InstalledExecutable.name; size = $Preflight.InstalledExecutable.size; sha256 = $Preflight.InstalledExecutable.sha256 } } else { $null }
        installedMatchesCandidate = $Preflight.InstalledMatchesCandidate
        ownerCommand = $OwnerCommand
        mutationPerformed = $false
    }
}

function Build-CandidatePackages {
    Write-Host "Building a fresh MSI and its matching release executable from the current branch..." -ForegroundColor Cyan
    Push-Location $repoRoot
    try {
        & pnpm tauri:build -- --bundles msi
        if ($LASTEXITCODE -ne 0) { throw "Tauri MSI package build failed with exit code $LASTEXITCODE." }
        $artifacts = Get-RawCandidateArtifacts
        Write-JsonFile $candidateReceiptPath ([ordered]@{
            schemaVersion = 1
            purpose = "prompt-vault-msi-refresh-candidate"
            createdAtUtc = [DateTimeOffset]::UtcNow.ToString("o")
            candidateMsi = [ordered]@{ name = $artifacts.Msi.name; size = $artifacts.Msi.size; sha256 = $artifacts.Msi.sha256 }
            candidateExecutable = [ordered]@{ name = $artifacts.Executable.name; size = $artifacts.Executable.size; sha256 = $artifacts.Executable.sha256 }
        }) 8
        Get-CandidateArtifacts | Out-Null
    } finally { Pop-Location }
}

function New-ElevationManifest($Preflight, [string]$Root) {
    if (-not $Preflight.Registration.Found -or $Preflight.Registration.Scope -ne "PerMachine") { throw "Elevation preparation requires exactly one per-machine Prompt Vault registration." }
    if ($Preflight.ActiveInstallerTransaction) { throw "An active Windows Installer transaction was detected; no elevation manifest was created." }
    if (-not $Preflight.InstalledExecutable) { throw "Installed executable identity is required before elevation preparation." }
    $evidence = Initialize-EvidenceRoot $Root
    $manifest = New-ContinuationManifestData -RepositoryRoot $repoRoot -ScriptPath $scriptPath -EvidenceRoot $evidence -ProductCode $Preflight.Registration.ProductCode -TimeoutSeconds $MsiTimeoutSeconds -CloseTimeoutSeconds $CloseTimeoutSeconds -CandidateMsi $Preflight.Artifacts.Msi -CandidateExecutable $Preflight.Artifacts.Executable -InstalledExecutable $Preflight.InstalledExecutable -ScriptSha256 (Get-FileHash -LiteralPath $scriptPath -Algorithm SHA256).Hash -CoreModulePath $coreModule -CoreModuleSha256 (Get-FileHash -LiteralPath $coreModule -Algorithm SHA256).Hash
    $manifestPath = Join-Path $evidence "elevation-continuation.v1.private.json"
    Write-JsonFile $manifestPath $manifest 12
    $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
    $privatePreflight = [ordered]@{
        registration = $Preflight.Registration
        isElevated = $Preflight.IsElevated
        activeInstallerTransaction = $Preflight.ActiveInstallerTransaction
        runningProcesses = @($Preflight.RunningPromptVaultProcesses | ForEach-Object {
            [ordered]@{
                processId = $_.Id
                startedAtUtc = $_.StartTimeUtc
                executablePath = $_.Path
            }
        })
        artifacts = $Preflight.Artifacts
        installedExecutable = $Preflight.InstalledExecutable
        candidateMatchesInstalled = $Preflight.InstalledMatchesCandidate
    }
    Write-JsonFile (Join-Path $evidence "preflight.private.json") $privatePreflight 12
    $command = New-ElevationCommand $scriptPath $manifestPath $manifestHash
    Write-JsonFile (Join-Path $evidence "preparation-summary.json") ([ordered]@{ version = 1; prepared = $true; installationScope = "PerMachine"; manifestSha256 = $manifestHash; candidateMsiSha256 = $Preflight.Artifacts.Msi.sha256; candidateExecutableSha256 = $Preflight.Artifacts.Executable.sha256; installedExecutableSha256 = $Preflight.InstalledExecutable.sha256; expiresAtUtc = $manifest.expiresAtUtc; privatePathsRedacted = $true; mutationPerformed = $false })
    return [pscustomobject]@{ EvidenceRoot = $evidence; ManifestPath = $manifestPath; ManifestSha256 = $manifestHash; Command = $command }
}

function Get-ValidatedContinuation([string]$ManifestPath, [string]$ExpectedHash) {
    $canonicalManifestPath = ConvertTo-CanonicalWindowsPath $ManifestPath "Continuation manifest path"
    if (-not (Test-Path -LiteralPath $canonicalManifestPath -PathType Leaf)) { throw "Continuation manifest was not found." }
    if (Test-ReparsePath $canonicalManifestPath) { throw "Continuation manifest must not traverse a reparse point." }
    $manifestBytes = [IO.File]::ReadAllBytes($canonicalManifestPath)
    $manifestStream = [IO.MemoryStream]::new($manifestBytes, $false)
    try { $actualHash = (Get-FileHash -InputStream $manifestStream -Algorithm SHA256).Hash } finally { $manifestStream.Dispose() }
    if ((ConvertTo-CanonicalSha256 $ExpectedHash "Expected manifest SHA-256") -ne $actualHash) { throw "Continuation manifest hash mismatch; the manifest may have been tampered with." }
    $manifestJson = ([Text.UTF8Encoding]::new($false, $true)).GetString($manifestBytes).TrimStart([char]0xFEFF)
    $manifest = $manifestJson | ConvertFrom-Json -Depth 20
    Test-ContinuationManifestData -Manifest $manifest -ExpectedManifestSha256 $ExpectedHash -ActualManifestSha256 $actualHash -ReplayMarkerExists $false | Out-Null
    $evidence = Assert-ExistingEvidenceRoot ([string]$manifest.evidenceRoot)
    $expectedManifestPath = ConvertTo-CanonicalWindowsPath (Join-Path $evidence "elevation-continuation.v1.private.json") "Expected continuation manifest path"
    if (-not $canonicalManifestPath.Equals($expectedManifestPath, [StringComparison]::OrdinalIgnoreCase)) { throw "Continuation manifest is not the reviewed manifest inside its evidence root." }
    $replayPath = Join-Path $evidence "continuation-$($manifest.nonce).consumed.private.json"
    if (Test-Path -LiteralPath $replayPath) { throw "Continuation manifest has already been consumed and cannot be replayed." }
    if (-not ([string]$manifest.repositoryRoot).Equals($repoRoot, [StringComparison]::OrdinalIgnoreCase) -or -not ([string]$manifest.scriptPath).Equals($scriptPath, [StringComparison]::OrdinalIgnoreCase) -or -not ([string]$manifest.coreModulePath).Equals($coreModule, [StringComparison]::OrdinalIgnoreCase)) { throw "Continuation repository, script, or core-module identity changed." }
    Assert-ExecutableIdentity $manifest.scriptSha256 (Get-FileHash -LiteralPath $scriptPath -Algorithm SHA256).Hash "Installer script" | Out-Null
    Assert-ExecutableIdentity $manifest.coreModuleSha256 (Get-FileHash -LiteralPath $coreModule -Algorithm SHA256).Hash "Installer core module" | Out-Null
    $registration = Resolve-PromptVaultRegistration (Get-PromptVaultInstallRecords)
    if (-not $registration.Found -or $registration.Scope -ne "PerMachine" -or $registration.ProductCode -ne $manifest.productCode) { throw "Current registration no longer matches the reviewed continuation manifest." }
    Assert-ArtifactMatches $manifest.candidateMsi "Candidate MSI" | Out-Null
    Assert-ArtifactMatches $manifest.candidateExecutable "Candidate executable" | Out-Null
    Assert-ArtifactMatches $manifest.installedExecutable "Installed executable" | Out-Null
    return [pscustomobject]@{ Manifest = $manifest; ManifestPath = $ManifestPath; ManifestSha256 = $actualHash; EvidenceRoot = $evidence; ReplayPath = $replayPath; Registration = $registration }
}

function Write-ReplayMarker($Continuation) {
    $payload = [Text.Encoding]::UTF8.GetBytes((([ordered]@{ schemaVersion = 1; nonce = $Continuation.Manifest.nonce; manifestSha256 = $Continuation.ManifestSha256; consumedAtUtc = [DateTimeOffset]::UtcNow.ToString("o") } | ConvertTo-Json -Compress)))
    $stream = [IO.File]::Open($Continuation.ReplayPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($payload, 0, $payload.Length); $stream.Flush($true) } finally { $stream.Dispose() }
}

function Invoke-Refresh($Registration, $Artifacts, [string]$Root, [int]$TimeoutSeconds, [int]$AppCloseTimeoutSeconds, [switch]$UseExistingEvidence, [switch]$ExplicitElevationContinuation, [switch]$Launch) {
    Assert-MsiStartAllowed -Scope $Registration.Scope -IsElevated (Test-CurrentProcessElevated) -ExplicitElevationContinuation ([bool]$ExplicitElevationContinuation) -ActiveInstallerTransaction (Test-ActiveWindowsInstallerTransaction) | Out-Null
    $evidence = if ($UseExistingEvidence) { Assert-ExistingEvidenceRoot $Root } else { Initialize-EvidenceRoot $Root }
    $protectedBefore = $null
    $protectedAfter = $null
    $protectedUnchanged = $false
    $sequence = $null
    $installedBefore = $null
    $installedAfter = $null
    $closeResult = $null
    $success = $false
    $errorMessage = $null
    try {
        Assert-MsiStartAllowed -Scope $Registration.Scope -IsElevated (Test-CurrentProcessElevated) -ExplicitElevationContinuation ([bool]$ExplicitElevationContinuation) -ActiveInstallerTransaction (Test-ActiveWindowsInstallerTransaction) | Out-Null
        Assert-ArtifactMatches $Artifacts.Msi "Candidate MSI" | Out-Null
        Assert-ArtifactMatches $Artifacts.Executable "Candidate executable" | Out-Null
        $installedBefore = Get-InstalledExecutableInfo $Registration
        $protectedBefore = Get-ProtectedInventory
        Write-JsonFile (Join-Path $evidence "protected-before.private.json") $protectedBefore 8
        $closeResult = Close-PromptVaultGracefully $AppCloseTimeoutSeconds $installedBefore.path
        $uninstallLog = Join-Path $evidence "msi-uninstall.private.log"
        $installLog = Join-Path $evidence "msi-install.private.log"
        $uninstallAction = {
            Invoke-MsiOperation -Operation Uninstall -Operand $Registration.ProductCode -LogPath $uninstallLog -TimeoutSeconds $TimeoutSeconds
        }.GetNewClosure()
        $installAction = {
            Assert-ArtifactMatches $Artifacts.Msi "Candidate MSI before install" | Out-Null
            Assert-ArtifactMatches $Artifacts.Executable "Candidate executable before install" | Out-Null
            Invoke-MsiOperation -Operation Install -Operand $Artifacts.Msi.path -LogPath $installLog -TimeoutSeconds $TimeoutSeconds
        }.GetNewClosure()
        $sequence = Invoke-MsiRefreshSequence -UninstallAction $uninstallAction -InstallAction $installAction
        $registrationAfter = Resolve-PromptVaultRegistration (Get-PromptVaultInstallRecords)
        if (-not $registrationAfter.Found) { throw "Prompt Vault registration was absent after the reported successful install." }
        $installedAfter = Get-InstalledExecutableInfo $registrationAfter
        Assert-ExecutableIdentity $Artifacts.Executable.sha256 $installedAfter.sha256 "Installed Prompt Vault executable" | Out-Null
        $protectedAfter = Get-ProtectedInventory
        Write-JsonFile (Join-Path $evidence "protected-after.private.json") $protectedAfter 8
        Compare-ProtectedInventories $protectedBefore $protectedAfter | Out-Null
        $protectedUnchanged = $true
        if ($Launch) { Start-Process -FilePath $installedAfter.path | Out-Null }
        $success = $true
    } catch {
        $errorMessage = $_.Exception.Message
        throw
    } finally {
        if ($protectedBefore -and -not $protectedAfter) {
            try {
                $protectedAfter = Get-ProtectedInventory
                Write-JsonFile (Join-Path $evidence "protected-after.private.json") $protectedAfter 8
                Compare-ProtectedInventories $protectedBefore $protectedAfter | Out-Null
                $protectedUnchanged = $true
            } catch {
                $success = $false
                $protectedUnchanged = $false
                $preservationFailure = $_.Exception.Message
                $errorMessage = if ($errorMessage) { "$errorMessage | $preservationFailure" } else { $preservationFailure }
            }
        }
        $privateResult = [ordered]@{ version = 1; success = $success; evidenceRoot = $evidence; registration = $Registration; artifacts = $Artifacts; close = $closeResult; sequence = $sequence; installedBefore = $installedBefore; installedAfter = $installedAfter; protectedBefore = $protectedBefore; protectedAfter = $protectedAfter; error = $errorMessage; automaticLaunch = [bool]$Launch }
        Write-JsonFile (Join-Path $evidence "refresh-result.private.json") $privateResult 14
        $safeResult = [ordered]@{
            version = 1
            success = $success
            installationScope = $Registration.Scope
            productCode = $Registration.ProductCode
            candidateMsi = [ordered]@{ name = $Artifacts.Msi.name; size = $Artifacts.Msi.size; sha256 = $Artifacts.Msi.sha256; signatureStatus = $Artifacts.Msi.signatureStatus }
            candidateExecutable = [ordered]@{ name = $Artifacts.Executable.name; size = $Artifacts.Executable.size; sha256 = $Artifacts.Executable.sha256 }
            installedExecutableSha256 = if ($installedAfter) { $installedAfter.sha256 } else { $null }
            installedMatchesCandidate = if ($installedAfter) { $installedAfter.sha256 -eq $Artifacts.Executable.sha256 } else { $false }
            uninstall = if ($sequence -and $sequence.Uninstall) { [ordered]@{ exitCode = $sequence.Uninstall.ExitCode; category = $sequence.Uninstall.Category; rebootRequired = $sequence.Uninstall.RebootRequired } } else { $null }
            install = if ($sequence -and $sequence.Install) { [ordered]@{ exitCode = $sequence.Install.ExitCode; category = $sequence.Install.Category; rebootRequired = $sequence.Install.RebootRequired } } else { $null }
            processClose = $closeResult
            protectedFilesUnchanged = $protectedUnchanged
            automaticLaunch = [bool]$Launch
            privatePathsRedacted = $true
            error = if ($errorMessage) { ConvertTo-SafeError $errorMessage $evidence } else { $null }
        }
        Write-JsonFile (Join-Path $evidence "refresh-summary.json") $safeResult 10
    }
    return [pscustomobject]@{ Success = $success; EvidenceRoot = $evidence; InstalledExecutable = $installedAfter; Sequence = $sequence }
}

Write-Host "Prompt Vault local desktop refresh" -ForegroundColor Cyan
Write-Host "Trust status: unsigned local development package" -ForegroundColor Yellow
Write-Host "This workflow inventories protected DB/WAL/SHM files without opening SQLite." -ForegroundColor Yellow
Write-Host "Application launch is disabled unless -LaunchAfterInstall is explicitly supplied." -ForegroundColor Yellow

if ($PreflightOnly) {
    $preflight = Get-Preflight
    $recommended = Get-RecommendedEvidencePath
    $ownerCommand = New-PrepareElevationCommand $scriptPath $recommended $MsiTimeoutSeconds $CloseTimeoutSeconds -SkipBuild:$preflight.Artifacts.Available
    Get-SafePreflight $preflight $ownerCommand | ConvertTo-Json -Depth 10
    exit 0
}

if ($RequestElevation) {
    $continuation = Get-ValidatedContinuation $ContinuationManifest $ExpectedManifestSha256
    if (Test-ActiveWindowsInstallerTransaction) { throw "An active Windows Installer transaction was detected before elevation; no UAC request was started." }
    $childArguments = @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $scriptPath,
        "-ExecuteContinuation", "-ContinuationManifest", $ContinuationManifest,
        "-ExpectedManifestSha256", (ConvertTo-CanonicalSha256 $ExpectedManifestSha256)
    )
    if (Test-CurrentProcessElevated) {
        & pwsh @childArguments
        if ($LASTEXITCODE -ne 0) { throw "Elevated continuation exited with code $LASTEXITCODE." }
    } else {
        $childArgumentLine = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -ExecuteContinuation -ContinuationManifest `"$ContinuationManifest`" -ExpectedManifestSha256 $(ConvertTo-CanonicalSha256 $ExpectedManifestSha256)"
        Invoke-ExplicitElevationRequest { Start-Process -FilePath "pwsh" -Verb RunAs -ArgumentList $childArgumentLine -Wait -PassThru } | Out-Null
    }
    exit 0
}

if ($ExecuteContinuation) {
    $continuationElevated = Test-CurrentProcessElevated
    if (-not $continuationElevated) { throw "Continuation process is not elevated; no MSI process was started." }
    $continuation = Get-ValidatedContinuation $ContinuationManifest $ExpectedManifestSha256
    Assert-MsiStartAllowed -Scope $continuation.Registration.Scope -IsElevated $continuationElevated -ExplicitElevationContinuation $true -ActiveInstallerTransaction (Test-ActiveWindowsInstallerTransaction) | Out-Null
    Write-ReplayMarker $continuation
    $artifacts = [pscustomobject]@{ Available = $true; Msi = $continuation.Manifest.candidateMsi; Executable = $continuation.Manifest.candidateExecutable }
    Invoke-Refresh -Registration $continuation.Registration -Artifacts $artifacts -Root $continuation.EvidenceRoot -TimeoutSeconds ([int]$continuation.Manifest.timeoutSeconds) -AppCloseTimeoutSeconds ([int]$continuation.Manifest.closeTimeoutSeconds) -UseExistingEvidence -ExplicitElevationContinuation -Launch:$LaunchAfterInstall | Out-Null
    exit 0
}

$initial = Get-Preflight
if ($initial.Registration.Found -and $initial.Registration.Scope -eq "PerMachine") {
    if (-not $PrepareElevation) {
        $recommended = Get-RecommendedEvidencePath
        $command = New-PrepareElevationCommand $scriptPath $recommended $MsiTimeoutSeconds $CloseTimeoutSeconds -SkipBuild:$SkipBuild
        throw "Prompt Vault is registered per-machine. A reviewed elevation manifest is required before MSI starts. No build, evidence, application close, or installer process was started. Run exactly: $command"
    }
    if (-not $SkipBuild) { Build-CandidatePackages }
    $preparedPreflight = Get-Preflight -RequireArtifacts
    $prepared = New-ElevationManifest $preparedPreflight $EvidencePath
    Write-Host "Elevation continuation manifest created without starting UAC or MSI." -ForegroundColor Green
    Write-Host "Review the private manifest and safe summary, then explicitly authorize UAC with:" -ForegroundColor Yellow
    Write-Output $prepared.Command
    exit 0
}

if ($PrepareElevation) { throw "-PrepareElevation is valid only for one per-machine Prompt Vault registration." }
if (-not $initial.Registration.Found) { throw "No installed Prompt Vault registration was found; this guarded refresh refuses to become a first-install workflow." }
Assert-MsiStartAllowed -Scope $initial.Registration.Scope -IsElevated $initial.IsElevated -ExplicitElevationContinuation $false -ActiveInstallerTransaction $initial.ActiveInstallerTransaction | Out-Null
if (-not $SkipBuild) { Build-CandidatePackages }
$directPreflight = Get-Preflight -RequireArtifacts
Assert-MsiStartAllowed -Scope $directPreflight.Registration.Scope -IsElevated $directPreflight.IsElevated -ExplicitElevationContinuation $false -ActiveInstallerTransaction $directPreflight.ActiveInstallerTransaction | Out-Null
$root = if ([string]::IsNullOrWhiteSpace($EvidencePath)) { Get-RecommendedEvidencePath } else { $EvidencePath }
Invoke-Refresh -Registration $directPreflight.Registration -Artifacts $directPreflight.Artifacts -Root $root -TimeoutSeconds $MsiTimeoutSeconds -AppCloseTimeoutSeconds $CloseTimeoutSeconds -Launch:$LaunchAfterInstall | Out-Null
Write-Host "Installed Prompt Vault was refreshed and verified successfully." -ForegroundColor Green
Write-Host "Protected current and historical DB/WAL/SHM files remained byte-identical." -ForegroundColor Green
if ($LaunchAfterInstall) {
    Write-Host "Application launch was explicitly requested after verification." -ForegroundColor Yellow
} else {
    Write-Host "Application launch was not requested." -ForegroundColor Yellow
}

$schemaChanges = git status --short -- src-tauri/gen/schemas
if ($schemaChanges) {
    Write-Warning "Tauri regenerated tracked schema files during the build. Review or restore them before committing unrelated work."
    $schemaChanges | Write-Host
}
