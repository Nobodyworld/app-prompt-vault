[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isElevated = ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class SyntheticOperatorDesktop {
    [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder text, int length, out int needed);
    static string Name(IntPtr handle) {
        var text = new StringBuilder(512); int needed;
        if (!GetUserObjectInformation(handle, 2, text, text.Capacity * 2, out needed)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return text.ToString();
    }
    public static string CallerDesktop() { return Name(GetProcessWindowStation()) + "\\" + Name(GetThreadDesktop(GetCurrentThreadId())); }
}
'@
$context = @{ user = $identity.Name; sid = $identity.User.Value; sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId; callerDesktop = [SyntheticOperatorDesktop]::CallerDesktop(); elevated = $isElevated; interactive = [Environment]::UserInteractive }
if ($request.action -eq 'context') { $context | ConvertTo-Json -Compress; exit 0 }
if ($isElevated -or $identity.User.Value -ne $request.ownerSid -or $context.sessionId -eq 0) { throw 'Intended non-elevated operator session required.' }
$installRoot = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Prompt Vault Update Acceptance'
$dataRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'com.nobodyworld.promptvault.updateacceptance'
$executablePath = Join-Path $installRoot 'prompt-vault-update-acceptance.exe'
$handles = [Collections.Generic.List[IDisposable]]::new()

function Assert-Plain([string]$Path) {
    if ($Path -notmatch '^[A-Za-z]:\\' -or $Path -cne $Path.Trim() -or $Path.Substring(2) -match '["<>|?*:~\x00-\x1f]') { throw 'Ambiguous path refused.' }
    foreach ($part in $Path.Substring(3).Split('\')) { if (-not $part -or $part -in @('.', '..') -or $part -match '[. ]$') { throw 'Ambiguous path refused.' } }
    $cursor = $Path
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse path refused.' }
        }
        $parent = Split-Path -Parent $cursor
        if ($parent -eq $cursor) { break }; $cursor = $parent
    }
}
function Digest([string]$Path, [switch]$Lock) {
    Assert-Plain $Path
    $file = Get-Item -LiteralPath $Path -Force
    if ($file.PSIsContainer) { throw 'File required.' }
    $stream = [IO.File]::Open($Path, 'Open', 'Read', 'Read')
    try {
        $result = @{ byteLength = $stream.Length; sha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)).ToLowerInvariant() }
        if ($Lock) { $handles.Add($stream); $stream = $null }
        return $result
    } finally { if ($stream) { $stream.Dispose() } }
}
function Data-Inventory {
    Assert-Plain $dataRoot
    $names = @('acceptance.db', 'acceptance.db-wal', 'acceptance.db-shm', 'backup.db', 'restore-check.db', 'restore-check.db-wal', 'restore-check.db-shm', 'logical-expected.txt', 'logical-observed.txt')
    if (Test-Path -LiteralPath $dataRoot) {
        foreach ($item in Get-ChildItem -LiteralPath $dataRoot -Force) { if ($item.PSIsContainer -or $item.Name -notin $names) { throw 'Unknown synthetic data item; retain it.' } }
    }
    return @(foreach ($name in $names) {
        $path = Join-Path $dataRoot $name; $exists = Test-Path -LiteralPath $path
        $digest = if ($exists) { Digest $path } else { $null }
        @{ path = $name; exists = $exists; bytes = $(if ($exists) { $digest.byteLength } else { 0 }); sha256 = $(if ($exists) { $digest.sha256 } else { $null }) }
    })
}
function Verified-Processes([string]$ExpectedHash) {
    $result = @()
    foreach ($record in Get-CimInstance Win32_Process -Property Name,ProcessId,ExecutablePath,CreationDate,SessionId) {
        if ($record.Name -ieq 'prompt-vault-update-acceptance.exe' -or ($record.ExecutablePath -and $record.ExecutablePath.StartsWith($installRoot + '\', [StringComparison]::OrdinalIgnoreCase))) {
            if (-not [string]::Equals($record.ExecutablePath, $executablePath, [StringComparison]::OrdinalIgnoreCase) -or $record.SessionId -ne $context.sessionId -or (Digest $record.ExecutablePath).sha256 -ne $ExpectedHash) { throw 'Unverified process; no shutdown allowed.' }
            $process = Get-Process -Id $record.ProcessId
            # CIM timestamps carry microseconds; compare at that precision while
            # retaining the process handle for the subsequent close request.
            $null = $process.Handle
            if ($process.Path -ine $executablePath -or $process.StartTime.ToUniversalTime().ToString('yyyyMMddHHmmss.ffffff') -cne $record.CreationDate.ToUniversalTime().ToString('yyyyMMddHHmmss.ffffff')) { throw 'Process identity changed.' }
            $result += $process
        }
    }
    return $result
}
try {
    Assert-Plain $installRoot; Assert-Plain $dataRoot
    if ($request.action -eq 'inventory') { @(Data-Inventory) | ConvertTo-Json -Depth 8 -Compress; exit 0 }
    $manifestPath = [string]$request.manifestPath
    $manifestDigest = Digest $manifestPath -Lock
    if ($manifestDigest.sha256 -cne $request.manifestSha256) { throw 'Manifest changed at execution boundary.' }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.application.identifier -cne 'com.nobodyworld.promptvault.updateacceptance' -or $manifest.msi.upgradeCode -cne '{975929E8-18E6-44F5-BA40-157F667F18CD}' -or $manifest.msi.installScope -cne 'per-machine' -or $manifest.executable.relativePath -cne 'prompt-vault-update-acceptance.exe' -or $manifest.artifact.relativePath -cne 'acceptance.msi') { throw 'Synthetic identity required.' }
    $msiPath = Join-Path (Split-Path -Parent $manifestPath) 'acceptance.msi'
    $msiDigest = Digest $msiPath -Lock
    if ($msiDigest.sha256 -cne $manifest.artifact.sha256 -or $msiDigest.byteLength -ne $manifest.artifact.byteLength) { throw 'Package changed at execution boundary.' }
    if ($request.action -eq 'shutdown') {
        $processes = @(Verified-Processes $manifest.executable.sha256)
        foreach ($process in $processes) { if (-not $process.CloseMainWindow()) { @{ status = 'refused' } | ConvertTo-Json -Compress; exit 0 } }
        $deadline = [DateTime]::UtcNow.AddSeconds(5)
        foreach ($process in $processes) {
            $remaining = [Math]::Max(0, [int]($deadline - [DateTime]::UtcNow).TotalMilliseconds)
            if (-not $process.WaitForExit($remaining)) { @{ status = 'timeout' } | ConvertTo-Json -Compress; exit 0 }
        }
        if (@(Verified-Processes $manifest.executable.sha256).Count) { throw 'Process appeared after shutdown.' }
        @{ status = 'stopped' } | ConvertTo-Json -Compress; exit 0
    }
    if ($request.action -eq 'restart') {
        if ((Digest $executablePath -Lock).sha256 -cne $manifest.executable.sha256 -or @(Verified-Processes $manifest.executable.sha256).Count) { throw 'Restart identity or exclusivity refused.' }
        $argument = [string]$request.argument
        if ($argument -notin @('--run', '--seed', '--refuse-close', '--restart-failure')) { throw 'Unsupported synthetic launch.' }
        if ($argument -eq '--seed' -and (Test-Path -LiteralPath $dataRoot)) { throw 'Existing data is protected from seeding.' }
        # This is the explicitly requested interactive fixture; readiness and graceful close require its visible main window.
        $process = Start-Process -FilePath $executablePath -ArgumentList $argument -PassThru -WindowStyle Normal
        $deadline = [DateTime]::UtcNow.AddSeconds(10)
        $ready = $false
        while ([DateTime]::UtcNow -lt $deadline -and -not $process.HasExited) {
            $process.Refresh()
            if ($process.MainWindowHandle -ne 0 -and (Test-Path -LiteralPath (Join-Path $dataRoot 'logical-observed.txt'))) {
                $ready = (Get-Content -LiteralPath (Join-Path $dataRoot 'logical-expected.txt') -Raw) -ceq (Get-Content -LiteralPath (Join-Path $dataRoot 'logical-observed.txt') -Raw)
                break
            }
            Start-Sleep -Milliseconds 100
        }
        if ($ready) { $null = @(Verified-Processes $manifest.executable.sha256) }
        @{ passed = $ready; pid = $process.Id; exitCode = $(if ($process.HasExited) { $process.ExitCode } else { $null }); context = $context } | ConvertTo-Json -Depth 5 -Compress; exit 0
    }
    if ($request.action -notin @('install', 'uninstall')) { throw 'Unsupported boundary action.' }
    if (@(Verified-Processes $request.installedExecutableSha256).Count) { throw 'Installer requires quiescence.' }
    Add-Type -Path (Join-Path $PSScriptRoot 'ReadOnlyMsi.cs')
    $db = [ReadOnlyMsi]::new($msiPath)
    try {
        $properties = @{}; foreach ($row in $db.Query('SELECT `Property`, `Value` FROM `Property`')) { $properties[$row[0]] = $row[1] }
        if ($properties.ProductName -cne 'Prompt Vault Update Acceptance' -or $properties.PV_ACCEPTANCE_IDENTIFIER -cne $manifest.application.identifier -or $properties.ProductCode -cne $manifest.msi.productCode -or $properties.UpgradeCode -cne $manifest.msi.upgradeCode -or $db.Summary(9) -cne $manifest.msi.packageCode -or $properties.ProductVersion -cne $manifest.application.version -or $properties.ALLUSERS -ne '1') { throw 'Boundary MSI identity mismatch.' }
        # The acceptance fixture has embedded complete media only. Recovery and
        # selected cabinet bytes are bound by locked MSI bytes and native inspection.
        foreach ($row in $db.Query('SELECT `Cabinet` FROM `Media`')) { if (-not $row[0].StartsWith('#')) { throw 'Unexpected external media refused.' } }
    } finally { $db.Dispose() }
    $related = @([ReadOnlyMsi]::RelatedProducts($manifest.msi.upgradeCode))
    if ($request.expectedProductCode) {
        if ($related.Count -ne 1 -or $related[0] -cne $request.expectedProductCode) { throw 'Installed target changed at execution boundary.' }
        if ([ReadOnlyMsi]::ProductInfo($related[0], 4, 'InstallLocation').TrimEnd('\') -ine $installRoot -or (Digest $executablePath).sha256 -cne $request.installedExecutableSha256) { throw 'Installed executable changed at execution boundary.' }
        if ([ReadOnlyMsi]::ProductInfo($related[0], 4, 'PackageCode') -cne $request.expectedPackageCode) { throw 'Installed package changed at execution boundary.' }
    } elseif ($related.Count -ne 0 -or (Test-Path -LiteralPath $installRoot)) { throw 'Baseline install requires no synthetic installation.' }
    if ($request.action -eq 'uninstall' -and $request.expectedProductCode -cne $manifest.msi.productCode) { throw 'Uninstall must match the retained exact package.' }
    if ($request.recoveryManifestPath) {
        if ((Digest $request.recoveryManifestPath -Lock).sha256 -cne $request.recoveryManifestSha256) { throw 'Recovery manifest changed.' }
        $recoveryManifest = Get-Content -LiteralPath $request.recoveryManifestPath -Raw | ConvertFrom-Json
        $recoveryMsi = Join-Path (Split-Path -Parent $request.recoveryManifestPath) 'acceptance.msi'
        $recoveryDigest = Digest $recoveryMsi -Lock
        if ($recoveryDigest.sha256 -cne $recoveryManifest.artifact.sha256 -or $recoveryDigest.byteLength -ne $recoveryManifest.artifact.byteLength) { throw 'Recovery media changed.' }
        # Use the merged collector for canonical LocalPackage path provenance.
        $observe = @{ selectedPath = $msiPath; recoveryPath = $recoveryMsi; procedurePath = $request.procedurePath } | ConvertTo-Json -Compress
        $observation = $observe | & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -NonInteractive -File (Join-Path $PSScriptRoot 'collect-update-evidence.ps1') -SyntheticAcceptance | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0 -or $observation.recoverySource -cne 'independent-media' -or $observation.errors.Count) { throw 'Recovery provenance unavailable.' }
        if ((Digest $request.procedurePath -Lock).sha256 -cne $recoveryManifest.recoveryProcedure.sha256) { throw 'Recovery procedure changed.' }
    } elseif ($request.action -eq 'install' -and $request.expectedProductCode) { throw 'Upgrade requires complete independent recovery media.' }
    Assert-Plain $request.resultPath; Assert-Plain $request.logPath
    if ((Test-Path -LiteralPath $request.resultPath) -or (Test-Path -LiteralPath $request.logPath)) { throw 'Existing attempt evidence is protected; no retry.' }
    $operation = if ($request.action -eq 'uninstall') { '/x' } else { '/i' }
    $arguments = "$operation `"$msiPath`" /qn /norestart /l*v `"$($request.logPath)`""
    if ($request.injectTransactionFailure) { $arguments += ' WIXFAILWHENDEFERRED=1' }
    $result = @{ launched = $false; exitCode = $null; launchError = $null; hresult = $null; exceptionType = $null; exceptionMessage = $null; scope = 'per-machine'; method = 'ProcessStartInfo UseShellExecute RunAs msiexec'; context = $context; uacObserved = 'operator-attestation-required'; package = $manifest; packageLockedAcrossConsent = $true; command = $arguments; logPath = $request.logPath; startedUtc = [DateTime]::UtcNow.ToString('o'); completedUtc = $null; rebootRequired = $null }
    $result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $request.resultPath
    try {
        # Exactly one ShellExecute attempt. Consent is controlled solely by the
        # operator. Neither a Win32 error nor RunAs proves a prompt was observed.
        # Start-Process can replace a Win32Exception with an InvalidOperationException
        # that loses NativeErrorCode. Use the same normal ShellExecute RunAs via
        # ProcessStartInfo to preserve 1223 without interpreting localized text.
        $startInfo = [Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = Join-Path $env:WINDIR 'System32\msiexec.exe'
        $startInfo.Arguments = $arguments
        $startInfo.UseShellExecute = $true
        $startInfo.Verb = 'runas'
        $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
        $installer = [Diagnostics.Process]::Start($startInfo)
        if ($null -eq $installer) { throw 'No installer process handle returned; inspect before continuing.' }
        $result.launched = $true
        if ($installer.WaitForExit(600000)) { $installer.Refresh(); $result.exitCode = $installer.ExitCode; $result.rebootRequired = $installer.ExitCode -in @(3010, 1641) }
    } catch {
        $cause = $_.Exception
        while ($cause.InnerException) { $cause = $cause.InnerException }
        $result.hresult = $cause.HResult
        $result.exceptionType = $cause.GetType().FullName
        $result.exceptionMessage = $cause.Message
        if ($cause -is [ComponentModel.Win32Exception]) { $result.launchError = $cause.NativeErrorCode }
    } finally { $result.completedUtc = [DateTime]::UtcNow.ToString('o'); $result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $request.resultPath }
    $result | ConvertTo-Json -Depth 12 -Compress
} finally { foreach ($handle in $handles) { $handle.Dispose() } }
