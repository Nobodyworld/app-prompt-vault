Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-OptionalProperty {
    param([Parameter(Mandatory)]$InputObject, [Parameter(Mandatory)][string]$Name)
    $property = $InputObject.PSObject.Properties[$Name]
    if ($property) { return $property.Value }
    return $null
}

function ConvertTo-CanonicalSha256 {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Value, [string]$Name = "SHA-256")
    if ($Value -notmatch '^[0-9A-Fa-f]{64}$') { throw "$Name must be exactly 64 hexadecimal characters." }
    return $Value.ToUpperInvariant()
}

function ConvertTo-CanonicalProductCodeValue {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Value)
    if ($Value -notmatch '^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$') {
        throw "MSI product code must be one canonical braced GUID."
    }
    $guid = [Guid]::Parse($Value.Trim('{}'))
    return "{$($guid.ToString().ToUpperInvariant())}"
}

function Get-MsiProductCode {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$InstallRecord)
    $candidates = [System.Collections.Generic.List[string]]::new()
    foreach ($value in @(
        (Get-OptionalProperty $InstallRecord "PSChildName"),
        (Get-OptionalProperty $InstallRecord "UninstallString"),
        (Get-OptionalProperty $InstallRecord "QuietUninstallString")
    )) {
        if (-not $value) { continue }
        foreach ($match in [regex]::Matches([string]$value, '\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}')) {
            $candidates.Add((ConvertTo-CanonicalProductCodeValue $match.Value))
        }
    }
    $unique = @($candidates | Sort-Object -Unique)
    if ($unique.Count -eq 0) { throw "Prompt Vault registration does not contain a valid MSI product code." }
    if ($unique.Count -ne 1) { throw "Prompt Vault registration contains ambiguous MSI product codes." }
    return $unique[0]
}

function Resolve-PromptVaultRegistration {
    [CmdletBinding()]
    param([AllowEmptyCollection()][object[]]$Records = @())
    $matches = @($Records | Where-Object { [string](Get-OptionalProperty $_ "DisplayName") -eq "Prompt Vault" })
    if ($matches.Count -gt 1) {
        $scopes = @($matches | ForEach-Object { [string](Get-OptionalProperty $_ "Scope") } | Sort-Object -Unique)
        throw "Prompt Vault has $($matches.Count) duplicate or ambiguous installation registrations across scopes: $($scopes -join ', ')."
    }
    if ($matches.Count -eq 0) {
        return [pscustomobject]@{ Found = $false; Scope = "None"; ProductCode = $null; Record = $null }
    }
    $record = $matches[0]
    $scope = [string](Get-OptionalProperty $record "Scope")
    if ($scope -notin @("PerUser", "PerMachine")) { throw "Prompt Vault registration has an unknown installation scope." }
    return [pscustomobject]@{ Found = $true; Scope = $scope; ProductCode = Get-MsiProductCode $record; Record = $record }
}

function Get-ElevationDisposition {
    [CmdletBinding()]
    param([Parameter(Mandatory)][ValidateSet("None", "PerUser", "PerMachine")][string]$Scope, [Parameter(Mandatory)][bool]$IsElevated)
    $required = $Scope -eq "PerMachine" -and -not $IsElevated
    return [pscustomobject]@{ Scope = $Scope; IsElevated = $IsElevated; ElevationRequired = $required; CanContinueInCurrentProcess = -not $required }
}

function Assert-MsiStartAllowed {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateSet("PerUser", "PerMachine")][string]$Scope,
        [Parameter(Mandatory)][bool]$IsElevated,
        [Parameter(Mandatory)][bool]$ExplicitElevationContinuation,
        [Parameter(Mandatory)][bool]$ActiveInstallerTransaction
    )
    if ($ActiveInstallerTransaction) { throw "An active Windows Installer transaction was detected; no MSI process may be started." }
    if ($Scope -eq "PerMachine") {
        if (-not $ExplicitElevationContinuation) { throw "A per-machine MSI refresh requires an explicit reviewed elevation continuation before MSI may start." }
        if (-not $IsElevated) { throw "The reviewed per-machine continuation is not elevated; no MSI process may be started." }
    } elseif ($ExplicitElevationContinuation) {
        throw "An elevation continuation cannot be used for a per-user registration."
    }
    return $true
}

function ConvertTo-CanonicalWindowsPath {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path, [string]$Name = "Path")
    if ([string]::IsNullOrWhiteSpace($Path) -or $Path -notmatch '^[A-Za-z]:\\') { throw "$Name must be an absolute local Windows drive path." }
    if ($Path.StartsWith('\\') -or $Path.StartsWith('\\?\') -or $Path.StartsWith('\\.\') -or $Path.Contains('/')) { throw "$Name must not be a UNC, device, or slash-normalized path." }
    if ($Path.IndexOf([char]0) -ge 0 -or $Path.Substring(2).Contains(':') -or $Path -match '[<>"|?*]') { throw "$Name contains prohibited Windows path characters." }
    $drive = $Path.Substring(0, 2).ToUpperInvariant()
    $tail = $Path.Substring(3)
    if ($tail.Length -eq 0) { return "$drive\" }
    $segments = @($tail -split '\\')
    $invalidSegments = @($segments | Where-Object { [string]::IsNullOrWhiteSpace($_) -or $_ -in @('.', '..') -or $_.EndsWith('.') -or $_.EndsWith(' ') })
    if ($segments.Count -eq 0 -or $invalidSegments.Count -gt 0) {
        throw "$Name contains an empty, traversal, or ambiguous path segment."
    }
    return "$drive\$($segments -join '\')"
}

function Test-WindowsPathContained {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Root)
    $child = ConvertTo-CanonicalWindowsPath $Path "Child path"
    $parent = ConvertTo-CanonicalWindowsPath $Root "Root path"
    if ($child.Equals($parent, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    $prefix = if ($parent.EndsWith('\')) { $parent } else { "$parent\" }
    return $child.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

function Get-DisplayIconExecutablePath {
    [CmdletBinding()]
    param([AllowEmptyString()][string]$DisplayIcon)
    if ([string]::IsNullOrWhiteSpace($DisplayIcon)) { return $null }
    $expanded = [Environment]::ExpandEnvironmentVariables($DisplayIcon.Trim())
    if ($expanded -notmatch '^(?:"(?<quoted>[^"]+\.exe)"|(?<bare>.+?\.exe))(?:\s*,\s*-?\d+)?$') { return $null }
    $candidate = if ($matches['quoted']) { $matches['quoted'] } else { $matches['bare'] }
    return ConvertTo-CanonicalWindowsPath $candidate "DisplayIcon executable path"
}

function Assert-EvidencePathContract {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$EvidencePath,
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [bool]$Exists = $false,
        [bool]$HasReparsePoint = $false,
        [switch]$AllowExisting
    )
    $canonical = ConvertTo-CanonicalWindowsPath $EvidencePath "Evidence path"
    $repo = ConvertTo-CanonicalWindowsPath $RepositoryRoot "Repository root"
    if (-not (Test-WindowsPathContained $canonical "C:\tmp") -or $canonical.Equals("C:\tmp", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Evidence path must be a fresh child beneath C:\tmp."
    }
    if (Test-WindowsPathContained $canonical $repo) { throw "Evidence path must remain outside the repository." }
    if ($HasReparsePoint) { throw "Evidence path must not traverse a reparse point." }
    if ($Exists -and -not $AllowExisting) { throw "Evidence path already exists; prior evidence is immutable." }
    if (-not $Exists -and $AllowExisting) { throw "Continuation evidence path does not exist." }
    return $canonical
}

function ConvertTo-PowerShellLiteral {
    param([Parameter(Mandatory)][string]$Value)
    return "'$($Value.Replace("'", "''"))'"
}

function New-PrepareElevationCommand {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$ScriptPath, [Parameter(Mandatory)][string]$EvidencePath, [Parameter(Mandatory)][int]$TimeoutSeconds, [Parameter(Mandatory)][int]$CloseTimeoutSeconds, [switch]$SkipBuild)
    $skip = if ($SkipBuild) { " -SkipBuild" } else { "" }
    return "pwsh -NoProfile -ExecutionPolicy Bypass -File $(ConvertTo-PowerShellLiteral $ScriptPath) -PrepareElevation -EvidencePath $(ConvertTo-PowerShellLiteral $EvidencePath) -MsiTimeoutSeconds $TimeoutSeconds -CloseTimeoutSeconds $CloseTimeoutSeconds$skip"
}

function New-ElevationCommand {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$ScriptPath, [Parameter(Mandatory)][string]$ManifestPath, [Parameter(Mandatory)][string]$ManifestSha256)
    $hash = ConvertTo-CanonicalSha256 $ManifestSha256 "Manifest SHA-256"
    return "pwsh -NoProfile -ExecutionPolicy Bypass -File $(ConvertTo-PowerShellLiteral $ScriptPath) -RequestElevation -ContinuationManifest $(ConvertTo-PowerShellLiteral $ManifestPath) -ExpectedManifestSha256 $hash"
}

function Assert-ExactPropertySet {
    param([Parameter(Mandatory)]$Value, [Parameter(Mandatory)][string[]]$Expected, [Parameter(Mandatory)][string]$Name)
    $received = if ($Value -is [System.Collections.IDictionary]) {
        @($Value.Keys | ForEach-Object { [string]$_ } | Sort-Object)
    } else {
        @($Value.PSObject.Properties.Name | Sort-Object)
    }
    $wanted = @($Expected | Sort-Object)
    if (($received -join "`n") -ne ($wanted -join "`n")) { throw "$Name contains missing or unrecognized fields." }
}

function Test-CandidateReceiptData {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Receipt, [Parameter(Mandatory)]$CandidateMsi, [Parameter(Mandatory)]$CandidateExecutable)
    Assert-ExactPropertySet $Receipt @("schemaVersion", "purpose", "createdAtUtc", "candidateMsi", "candidateExecutable") "Candidate receipt"
    if ([int]$Receipt.schemaVersion -ne 1 -or [string]$Receipt.purpose -ne "prompt-vault-msi-refresh-candidate") { throw "Candidate receipt version or purpose is unsupported." }
    [DateTimeOffset]::Parse([string]$Receipt.createdAtUtc, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind) | Out-Null
    foreach ($entry in @(
        [pscustomobject]@{ Name = "MSI"; Receipt = $Receipt.candidateMsi; Current = $CandidateMsi },
        [pscustomobject]@{ Name = "executable"; Receipt = $Receipt.candidateExecutable; Current = $CandidateExecutable }
    )) {
        Assert-ExactPropertySet $entry.Receipt @("name", "size", "sha256") "Candidate $($entry.Name) receipt"
        if ([string]$entry.Receipt.name -cne [string]$entry.Current.name -or [long]$entry.Receipt.size -ne [long]$entry.Current.size -or (ConvertTo-CanonicalSha256 ([string]$entry.Receipt.sha256) "Candidate $($entry.Name) receipt SHA-256") -ne (ConvertTo-CanonicalSha256 ([string]$entry.Current.sha256) "Candidate $($entry.Name) SHA-256")) {
            throw "Candidate $($entry.Name) no longer matches the MSI-only build receipt."
        }
    }
    return $true
}

function New-ContinuationManifestData {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$ScriptPath,
        [Parameter(Mandatory)][string]$EvidenceRoot,
        [Parameter(Mandatory)][string]$ProductCode,
        [Parameter(Mandatory)][int]$TimeoutSeconds,
        [Parameter(Mandatory)][int]$CloseTimeoutSeconds,
        [Parameter(Mandatory)]$CandidateMsi,
        [Parameter(Mandatory)]$CandidateExecutable,
        [Parameter(Mandatory)]$InstalledExecutable,
        [Parameter(Mandatory)][string]$ScriptSha256,
        [Parameter(Mandatory)][string]$CoreModulePath,
        [Parameter(Mandatory)][string]$CoreModuleSha256,
        [DateTimeOffset]$NowUtc = [DateTimeOffset]::UtcNow
    )
    return [ordered]@{
        schemaVersion = 1
        purpose = "prompt-vault-local-msi-refresh"
        nonce = [Guid]::NewGuid().ToString()
        createdAtUtc = $NowUtc.ToString("o")
        expiresAtUtc = $NowUtc.AddMinutes(30).ToString("o")
        repositoryRoot = ConvertTo-CanonicalWindowsPath $RepositoryRoot "Repository root"
        scriptPath = ConvertTo-CanonicalWindowsPath $ScriptPath "Script path"
        scriptSha256 = ConvertTo-CanonicalSha256 $ScriptSha256 "Installer script SHA-256"
        coreModulePath = ConvertTo-CanonicalWindowsPath $CoreModulePath "Core module path"
        coreModuleSha256 = ConvertTo-CanonicalSha256 $CoreModuleSha256 "Core module SHA-256"
        evidenceRoot = ConvertTo-CanonicalWindowsPath $EvidenceRoot "Evidence root"
        productCode = ConvertTo-CanonicalProductCodeValue $ProductCode
        installationScope = "PerMachine"
        timeoutSeconds = $TimeoutSeconds
        closeTimeoutSeconds = $CloseTimeoutSeconds
        candidateMsi = [ordered]@{ path = ConvertTo-CanonicalWindowsPath $CandidateMsi.path "Candidate MSI path"; sha256 = ConvertTo-CanonicalSha256 $CandidateMsi.sha256 "Candidate MSI SHA-256"; size = [long]$CandidateMsi.size; signatureStatus = [string]$CandidateMsi.signatureStatus }
        candidateExecutable = [ordered]@{ path = ConvertTo-CanonicalWindowsPath $CandidateExecutable.path "Candidate executable path"; sha256 = ConvertTo-CanonicalSha256 $CandidateExecutable.sha256 "Candidate executable SHA-256"; size = [long]$CandidateExecutable.size }
        installedExecutable = [ordered]@{ path = ConvertTo-CanonicalWindowsPath $InstalledExecutable.path "Installed executable path"; sha256 = ConvertTo-CanonicalSha256 $InstalledExecutable.sha256 "Installed executable SHA-256"; size = [long]$InstalledExecutable.size }
        protectedPathKeys = @("current-db", "current-wal", "current-shm", "historical-db", "historical-wal", "historical-shm")
    }
}

function Test-ContinuationManifestData {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Manifest,
        [Parameter(Mandatory)][string]$ExpectedManifestSha256,
        [Parameter(Mandatory)][string]$ActualManifestSha256,
        [DateTimeOffset]$NowUtc = [DateTimeOffset]::UtcNow,
        [bool]$ReplayMarkerExists = $false
    )
    if ((ConvertTo-CanonicalSha256 $ExpectedManifestSha256 "Expected manifest SHA-256") -ne (ConvertTo-CanonicalSha256 $ActualManifestSha256 "Actual manifest SHA-256")) { throw "Continuation manifest hash mismatch; the manifest may have been tampered with." }
    if ($ReplayMarkerExists) { throw "Continuation manifest has already been consumed and cannot be replayed." }
    Assert-ExactPropertySet $Manifest @("schemaVersion", "purpose", "nonce", "createdAtUtc", "expiresAtUtc", "repositoryRoot", "scriptPath", "scriptSha256", "coreModulePath", "coreModuleSha256", "evidenceRoot", "productCode", "installationScope", "timeoutSeconds", "closeTimeoutSeconds", "candidateMsi", "candidateExecutable", "installedExecutable", "protectedPathKeys") "Continuation manifest"
    if ([int]$Manifest.schemaVersion -ne 1 -or [string]$Manifest.purpose -ne "prompt-vault-local-msi-refresh") { throw "Continuation manifest version or purpose is unsupported." }
    $nonce = [Guid]::Empty
    if (-not [Guid]::TryParse([string]$Manifest.nonce, [ref]$nonce) -or $nonce -eq [Guid]::Empty) { throw "Continuation manifest nonce is invalid." }
    $created = [DateTimeOffset]::Parse([string]$Manifest.createdAtUtc, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
    $expires = [DateTimeOffset]::Parse([string]$Manifest.expiresAtUtc, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
    if ($expires -le $created -or ($expires - $created).TotalMinutes -gt 30.01) { throw "Continuation manifest lifetime is invalid." }
    if ($NowUtc -lt $created.AddMinutes(-2) -or $NowUtc -gt $expires) { throw "Continuation manifest is not currently valid or has expired." }
    if ([string]$Manifest.installationScope -ne "PerMachine") { throw "Elevation continuation is valid only for a per-machine registration." }
    if ([int]$Manifest.timeoutSeconds -lt 30 -or [int]$Manifest.timeoutSeconds -gt 3600) { throw "Continuation MSI timeout is outside the bounded 30-3600 second range." }
    if ([int]$Manifest.closeTimeoutSeconds -lt 5 -or [int]$Manifest.closeTimeoutSeconds -gt 300) { throw "Continuation close timeout is outside the bounded 5-300 second range." }
    $repo = ConvertTo-CanonicalWindowsPath ([string]$Manifest.repositoryRoot) "Manifest repository root"
    $script = ConvertTo-CanonicalWindowsPath ([string]$Manifest.scriptPath) "Manifest script path"
    $module = ConvertTo-CanonicalWindowsPath ([string]$Manifest.coreModulePath) "Manifest core module path"
    $evidence = Assert-EvidencePathContract ([string]$Manifest.evidenceRoot) $repo $true $false -AllowExisting
    if (-not (Test-WindowsPathContained $script $repo)) { throw "Continuation script must remain inside the recorded repository." }
    if (-not (Test-WindowsPathContained $module $repo)) { throw "Continuation core module must remain inside the recorded repository." }
    ConvertTo-CanonicalSha256 ([string]$Manifest.scriptSha256) "Installer script SHA-256" | Out-Null
    ConvertTo-CanonicalSha256 ([string]$Manifest.coreModuleSha256) "Core module SHA-256" | Out-Null
    ConvertTo-CanonicalProductCodeValue ([string]$Manifest.productCode) | Out-Null
    Assert-ExactPropertySet $Manifest.candidateMsi @("path", "sha256", "size", "signatureStatus") "Candidate MSI"
    Assert-ExactPropertySet $Manifest.candidateExecutable @("path", "sha256", "size") "Candidate executable"
    Assert-ExactPropertySet $Manifest.installedExecutable @("path", "sha256", "size") "Installed executable"
    foreach ($artifact in @($Manifest.candidateMsi, $Manifest.candidateExecutable)) {
        $artifactPath = ConvertTo-CanonicalWindowsPath ([string]$artifact.path) "Candidate artifact path"
        if (-not (Test-WindowsPathContained $artifactPath $repo)) { throw "Candidate artifacts must remain inside the recorded repository." }
        ConvertTo-CanonicalSha256 ([string]$artifact.sha256) "Candidate artifact SHA-256" | Out-Null
        if ([long]$artifact.size -le 0) { throw "Candidate artifact size must be positive." }
    }
    ConvertTo-CanonicalWindowsPath ([string]$Manifest.installedExecutable.path) "Installed executable path" | Out-Null
    ConvertTo-CanonicalSha256 ([string]$Manifest.installedExecutable.sha256) "Installed executable SHA-256" | Out-Null
    if ([long]$Manifest.installedExecutable.size -le 0) { throw "Installed executable size must be positive." }
    $expectedKeys = @("current-db", "current-wal", "current-shm", "historical-db", "historical-wal", "historical-shm")
    if ((@($Manifest.protectedPathKeys | Sort-Object) -join "`n") -ne (@($expectedKeys | Sort-Object) -join "`n")) { throw "Continuation protected-file key set is invalid." }
    return $true
}

function Get-MsiExitDisposition {
    [CmdletBinding()]
    param([Parameter(Mandatory)][ValidateSet("Uninstall", "Install")][string]$Operation, [Parameter(Mandatory)][int]$ExitCode, [string]$LogText = "")
    switch ($ExitCode) {
        0 { return [pscustomobject]@{ Success = $true; Category = "success"; RebootRequired = $false; Message = "$Operation completed successfully." } }
        1605 {
            if ($Operation -eq "Uninstall") { return [pscustomobject]@{ Success = $true; Category = "already-absent"; RebootRequired = $false; Message = "Uninstall reported that the product was already absent." } }
            return [pscustomobject]@{ Success = $false; Category = "install-product-unavailable"; RebootRequired = $false; Message = "Install returned 1605; the candidate package could not be applied as a registered product." }
        }
        1618 { return [pscustomobject]@{ Success = $false; Category = "installer-busy"; RebootRequired = $false; Message = "Windows Installer is already processing another transaction (1618)." } }
        3010 { return [pscustomobject]@{ Success = $true; Category = "success-reboot-required"; RebootRequired = $true; Message = "$Operation completed and requested a later reboot (3010); no restart was initiated." } }
        1603 {
            if ($LogText -match '(?im)(?:error\s+1730|\b1730\b.*(?:administrator|privilege)|(?:administrator|privilege).*\b1730\b)') {
                return [pscustomobject]@{ Success = $false; Category = "administrator-required"; RebootRequired = $false; Message = "$Operation failed with 1603 / MSI error 1730 because Administrator privileges are required." }
            }
            return [pscustomobject]@{ Success = $false; Category = "fatal-1603"; RebootRequired = $false; Message = "$Operation failed with generic Windows Installer error 1603; inspect the private verbose MSI log." }
        }
        default { return [pscustomobject]@{ Success = $false; Category = "unknown-exit-code"; RebootRequired = $false; Message = "$Operation failed with unrecognized Windows Installer exit code $ExitCode." } }
    }
}

function Compare-ProtectedInventories {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Before, [Parameter(Mandatory)]$After)
    $beforeNames = @($Before.PSObject.Properties.Name | Sort-Object)
    $afterNames = @($After.PSObject.Properties.Name | Sort-Object)
    if (($beforeNames -join "`n") -ne ($afterNames -join "`n")) { throw "Protected-file inventory keys changed." }
    foreach ($name in $beforeNames) {
        $left = $Before.PSObject.Properties[$name].Value | ConvertTo-Json -Compress -Depth 6
        $right = $After.PSObject.Properties[$name].Value | ConvertTo-Json -Compress -Depth 6
        if ($left -ne $right) { throw "Protected file changed: $name." }
    }
    return $true
}

function Assert-ProcessIdentity {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Expected, [Parameter(Mandatory)]$Actual)
    foreach ($field in @("Id", "StartTimeUtc", "Path")) {
        if ([string](Get-OptionalProperty $Expected $field) -cne [string](Get-OptionalProperty $Actual $field)) { throw "Prompt Vault process identity changed before graceful close." }
    }
    return $true
}

function Assert-ProcessExecutablePath {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$ExpectedPath, [Parameter(Mandatory)][string]$ActualPath)
    $expected = ConvertTo-CanonicalWindowsPath $ExpectedPath "Installed executable path"
    $actual = ConvertTo-CanonicalWindowsPath $ActualPath "Running process executable path"
    if (-not $expected.Equals($actual, [StringComparison]::OrdinalIgnoreCase)) {
        throw "A prompt-vault-app process does not match the installed executable path; graceful close is ambiguous."
    }
    return $true
}

function Invoke-GracefulPromptVaultClose {
    [CmdletBinding()]
    param(
        [AllowEmptyCollection()][object[]]$Processes = @(),
        [Parameter(Mandatory)][scriptblock]$CloseAction,
        [Parameter(Mandatory)][scriptblock]$WaitAction
    )
    if ($Processes.Count -gt 1) { throw "Multiple Prompt Vault processes are running; graceful close is ambiguous." }
    if ($Processes.Count -eq 0) { return [pscustomobject]@{ Closed = $false; ProcessId = $null; Method = "not-running" } }
    $process = $Processes[0]
    if (-not (& $CloseAction $process)) { throw "Prompt Vault did not accept a graceful window-close request." }
    if (-not (& $WaitAction $process)) { throw "Prompt Vault remained open after the bounded graceful-close wait; no force kill was attempted." }
    return [pscustomobject]@{ Closed = $true; ProcessId = [int](Get-OptionalProperty $process "Id"); Method = "graceful" }
}

function Wait-MsiProcessBounded {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Process, [Parameter(Mandatory)][int]$TimeoutSeconds, [Parameter(Mandatory)][scriptblock]$WaitAction)
    if ($TimeoutSeconds -lt 30 -or $TimeoutSeconds -gt 3600) { throw "MSI timeout is outside the bounded 30-3600 second range." }
    if (-not (& $WaitAction $Process $TimeoutSeconds)) { throw "Windows Installer exceeded the bounded timeout. The msiexec process was left running and the workflow stopped." }
    return [int](Get-OptionalProperty $Process "ExitCode")
}

function Invoke-MsiRefreshSequence {
    [CmdletBinding()]
    param([scriptblock]$UninstallAction, [Parameter(Mandatory)][scriptblock]$InstallAction)
    $uninstallResult = $null
    if ($UninstallAction) {
        $uninstallResult = & $UninstallAction
        if (-not [bool](Get-OptionalProperty $uninstallResult "Success")) { throw ([string](Get-OptionalProperty $uninstallResult "Message")) }
    }
    $installResult = & $InstallAction
    if (-not [bool](Get-OptionalProperty $installResult "Success")) { throw ([string](Get-OptionalProperty $installResult "Message")) }
    return [pscustomobject]@{ Uninstall = $uninstallResult; Install = $installResult }
}

function Invoke-ExplicitElevationRequest {
    [CmdletBinding()]
    param([Parameter(Mandatory)][scriptblock]$Launcher)
    try {
        $process = & $Launcher
        $exitCode = [int](Get-OptionalProperty $process "ExitCode")
        if ($exitCode -ne 0) { throw "Elevated continuation exited with code $exitCode." }
        return $process
    } catch {
        $nativeCode = Get-OptionalProperty $_.Exception "NativeErrorCode"
        if ($nativeCode -eq 1223 -or $_.Exception.Message -match '(?i)cancel(?:ed|led)|operation was canceled') {
            throw "Elevation request was canceled; no MSI continuation was started."
        }
        throw
    }
}

function Assert-ExecutableIdentity {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$ExpectedSha256, [Parameter(Mandatory)][string]$ActualSha256, [string]$Name = "Executable")
    if ((ConvertTo-CanonicalSha256 $ExpectedSha256 "$Name expected SHA-256") -ne (ConvertTo-CanonicalSha256 $ActualSha256 "$Name actual SHA-256")) { throw "$Name SHA-256 does not match the reviewed candidate." }
    return $true
}

Export-ModuleMember -Function @(
    "ConvertTo-CanonicalSha256",
    "ConvertTo-CanonicalProductCodeValue",
    "Get-MsiProductCode",
    "Resolve-PromptVaultRegistration",
    "Get-ElevationDisposition",
    "Assert-MsiStartAllowed",
    "ConvertTo-CanonicalWindowsPath",
    "Test-WindowsPathContained",
    "Get-DisplayIconExecutablePath",
    "Assert-EvidencePathContract",
    "New-PrepareElevationCommand",
    "New-ElevationCommand",
    "Test-CandidateReceiptData",
    "New-ContinuationManifestData",
    "Test-ContinuationManifestData",
    "Get-MsiExitDisposition",
    "Compare-ProtectedInventories",
    "Assert-ProcessIdentity",
    "Assert-ProcessExecutablePath",
    "Invoke-GracefulPromptVaultClose",
    "Wait-MsiProcessBounded",
    "Invoke-MsiRefreshSequence",
    "Invoke-ExplicitElevationRequest",
    "Assert-ExecutableIdentity"
)
