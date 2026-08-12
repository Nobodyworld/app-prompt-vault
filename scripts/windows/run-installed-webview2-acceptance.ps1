[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$EvidencePath,
    [Parameter(Mandatory = $true)][string]$CurrentDatabasePath,
    [Parameter(Mandatory = $true)][string]$LegacyDatabasePath,
    [Parameter(Mandatory = $true)][ValidatePattern("^[A-Fa-f0-9]{64}$")][string]$ExpectedExecutableSha256,
    [string]$InstalledExecutable = "C:\Program Files\Prompt Vault\prompt-vault-app.exe",
    [ValidateSet("self-test", "recovery")][string]$Scenario = "self-test",
    [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$result = [ordered]@{ success=$false; scenario=$Scenario; process=$null; listener=$null; cleanup="not-started"; failures=@() }
$evidence = $null
$app = $null
$recordedProcesses = @()

function Add-Failure([string]$Message) { $result.failures += $Message }
function Assert-AbsolutePath([string]$Path, [string]$Name) { if (-not [IO.Path]::IsPathFullyQualified($Path)) { throw "$Name must be absolute." }; [IO.Path]::GetFullPath($Path) }
function Assert-NoReparseAncestor([string]$Path) {
    $item = [IO.DirectoryInfo]::new($Path)
    while ($item) { if ($item.Exists -and (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw "Path contains a reparse-point ancestor: $($item.FullName)" }; $item = $item.Parent }
}
function Test-PathInside([string]$Child, [string]$Parent) { $childPath = [IO.Path]::GetFullPath($Child).TrimEnd('\'); $parentPath = [IO.Path]::GetFullPath($Parent).TrimEnd('\'); $childPath.StartsWith("$parentPath\", [StringComparison]::OrdinalIgnoreCase) }
function Assert-ExternalEvidencePath([string]$Path) {
    $resolved = Assert-AbsolutePath $Path "EvidencePath"
    if (-not $resolved.StartsWith("C:\tmp\", [StringComparison]::OrdinalIgnoreCase)) { throw "EvidencePath must be under C:\tmp." }
    if ($resolved.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "EvidencePath must not be inside the repository." }
    if (Test-Path -LiteralPath $resolved) { throw "EvidencePath already exists and must never be reused." }
    Assert-NoReparseAncestor (Split-Path -Parent $resolved)
    return $resolved
}
function Assert-DisposablePath([string]$Path, [string]$Name, [string]$EvidenceRoot) {
    $resolved = Assert-AbsolutePath $Path $Name
    if (-not (Test-PathInside $resolved $EvidenceRoot)) { throw "$Name must remain inside the new evidence root." }
    if ($resolved -match "(?i)com\.nobodyworld\.promptvault|com\.promptvault\.desktop") { throw "$Name points at a protected application-data location." }
    Assert-NoReparseAncestor (Split-Path -Parent $resolved)
    return $resolved
}
function Assert-InstalledExecutable([string]$Path, [string]$ExpectedHash) {
    $resolved = Assert-AbsolutePath $Path "InstalledExecutable"
    if ([IO.Path]::GetFileName($resolved) -ine "prompt-vault-app.exe") { throw "InstalledExecutable must be prompt-vault-app.exe." }
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "Installed executable was not found." }
    $actual = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash
    if ($actual -ine $ExpectedHash) { throw "Installed executable SHA-256 does not match the exact candidate." }
    return [pscustomobject]@{ Path=$resolved; Sha256=$actual }
}
function Get-FreeLoopbackPort { $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse("127.0.0.1"), 0); try { $listener.Start(); ([Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() } }
function Get-LoopbackListeners([int]$Port) { @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) }
function Test-DescendantProcess([int]$ProcessId, [int]$AncestorId) { $current = $ProcessId; for ($attempt = 0; $attempt -lt 32; $attempt++) { if ($current -eq $AncestorId) { return $true }; $row = Get-CimInstance Win32_Process -Filter "ProcessId=$current" -ErrorAction SilentlyContinue; if (-not $row -or -not $row.ParentProcessId) { return $false }; $current = [int]$row.ParentProcessId }; $false }
function Get-ProcessTree([int]$RootProcessId) {
    @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { Test-DescendantProcess $_.ProcessId $RootProcessId } | ForEach-Object { [pscustomobject]@{ ProcessId=[int]$_.ProcessId; CreationDate=$_.CreationDate; Name=$_.Name } })
}
function Wait-DevTools([int]$Port, [int]$AppProcessId) {
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while ([DateTime]::UtcNow -lt $deadline) {
        $listeners = Get-LoopbackListeners $Port
        if ($listeners.Count -gt 1 -or ($listeners.Count -eq 1 -and $listeners[0].LocalAddress -ne "127.0.0.1")) { throw "DevTools port has an unexpected listener." }
        if ($listeners.Count -eq 1 -and (Test-DescendantProcess $listeners[0].OwningProcess $AppProcessId)) {
            try { $version = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2; if ($version.Browser) { return $listeners[0] } } catch { }
        }
        Start-Sleep -Milliseconds 200
    }
    throw "Loopback DevTools endpoint did not become ready with one verified child listener."
}
function Save-Result([string]$EvidenceDirectory) { [pscustomobject]$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $EvidenceDirectory "orchestrator-result.json") }
function Get-FileInventory([string]$Path) { if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return [pscustomobject]@{ exists=$false; size=$null; lastWriteTimeUtc=$null; sha256=$null } }; $item=Get-Item -LiteralPath $Path; [pscustomobject]@{ exists=$true; size=$item.Length; lastWriteTimeUtc=$item.LastWriteTimeUtc.ToString("o"); sha256=(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash } }
function Save-ProtectedBaselines([string]$EvidenceDirectory) {
    $paths=@("$env:LOCALAPPDATA\com.nobodyworld.promptvault\prompt-vault.db","$env:LOCALAPPDATA\com.nobodyworld.promptvault\prompt-vault.db-wal","$env:LOCALAPPDATA\com.nobodyworld.promptvault\prompt-vault.db-shm","$env:LOCALAPPDATA\com.promptvault.desktop\prompt-vault.db","$env:LOCALAPPDATA\com.promptvault.desktop\prompt-vault.db-wal","$env:LOCALAPPDATA\com.promptvault.desktop\prompt-vault.db-shm")
    $paths | ForEach-Object { [pscustomobject]@{ path="[private path omitted]"; inventory=(Get-FileInventory $_) } } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $EvidenceDirectory "protected-database-baseline.json")
}
function Cleanup-AcceptanceProcess([int]$Port) {
    $cleanupFailures = [System.Collections.Generic.List[string]]::new()
    if ($app -and -not $app.HasExited) {
        $null = $app.CloseMainWindow()
        if (-not $app.WaitForExit(30000)) {
            $result.cleanup = "forced-containment"
            $cleanupFailures.Add("Launched application did not exit gracefully.")
            foreach ($process in $recordedProcesses) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
        } else { $result.cleanup = "graceful" }
    }
    foreach ($process in $recordedProcesses) { if (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue) { $cleanupFailures.Add("Recorded acceptance process remains: $($process.ProcessId)") } }
    if ((Get-LoopbackListeners $Port).Count -ne 0) { $cleanupFailures.Add("Loopback DevTools listener remained after cleanup.") }
    foreach ($failure in $cleanupFailures) { Add-Failure $failure }
}

try {
    # All checks here are non-mutating; an identity mismatch creates no evidence/profile/database/listener/process.
    $evidence = Assert-ExternalEvidencePath $EvidencePath
    $currentDb = Assert-DisposablePath $CurrentDatabasePath "CurrentDatabasePath" $evidence
    $legacyDb = Assert-DisposablePath $LegacyDatabasePath "LegacyDatabasePath" $evidence
    if ($currentDb -ieq $legacyDb) { throw "CurrentDatabasePath and LegacyDatabasePath must be distinct." }
    $candidate = Assert-InstalledExecutable $InstalledExecutable $ExpectedExecutableSha256
    if ($ValidateOnly) { $result.success = $true; $result.identity = [pscustomobject]@{ installedSha256=$candidate.Sha256; expectedSha256=$ExpectedExecutableSha256 }; Write-Output ($result | ConvertTo-Json -Depth 5); exit 0 }
    $alreadyRunning = @(Get-Process -Name "prompt-vault-app" -ErrorAction SilentlyContinue)
    if ($alreadyRunning.Count -ne 0) { throw "Prompt Vault is already running; close it normally before the installed acceptance harness starts." }
    New-Item -ItemType Directory -Path $evidence -ErrorAction Stop | Out-Null
    $webViewData = Join-Path $evidence "webview2-user-data"
    if (Test-Path -LiteralPath $webViewData) { throw "Fresh WebView2 profile path already exists." }
    New-Item -ItemType Directory -Path $webViewData -ErrorAction Stop | Out-Null
    if ($Scenario -eq "recovery") { Save-ProtectedBaselines $evidence }
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $port = Get-FreeLoopbackPort
        $startInfo = [Diagnostics.ProcessStartInfo]::new($candidate.Path); $startInfo.UseShellExecute = $false
        $startInfo.Environment["PROMPT_VAULT_DB_PATH"] = $currentDb; $startInfo.Environment["PROMPT_VAULT_LEGACY_DB_PATH"] = $legacyDb
        $startInfo.Environment["PROMPT_VAULT_TELEMETRY_OPTOUT"] = "1"; $startInfo.Environment["NW_TELEMETRY_OPTOUT"] = "1"
        $startInfo.Environment["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=$port"
        $startInfo.Environment["WEBVIEW2_USER_DATA_FOLDER"] = $webViewData
        $app = [Diagnostics.Process]::Start($startInfo); if (-not $app) { throw "Installed Prompt Vault process did not start." }
        $result.process = [pscustomobject]@{ ProcessId=$app.Id; CreationTimeUtc=$app.StartTime.ToUniversalTime().ToString("o") }
        try { $listener = Wait-DevTools $port $app.Id; break } catch { if ($attempt -eq 3) { throw }; $null = $app.CloseMainWindow(); $null = $app.WaitForExit(30000) }
    }
    $result.listener = [pscustomobject]@{ Port=$port; ProcessId=$listener.OwningProcess }
    $recordedProcesses = Get-ProcessTree $app.Id
    $measureScript = Join-Path $repoRoot "scripts\windows\measure-window-client.ps1"
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $measureScript -ProcessId $app.Id -ResizeToExpectedMinimum -RequireExactMinimum -AsJson | Set-Content -LiteralPath (Join-Path $evidence "window-minimum.json")
    if ($LASTEXITCODE -ne 0) { throw "Exact 400x600 window measurement failed." }
    Push-Location $repoRoot
    try { & pnpm tsx scripts/windows/installed-webview2-cdp.ts --port $port --evidence $evidence --scenario $Scenario; if ($LASTEXITCODE -ne 0) { throw "CDP $Scenario scenario failed with exit code $LASTEXITCODE." } } finally { Pop-Location }
    $result.success = $true
} catch { Add-Failure $_.Exception.Message; $result.success = $false } finally {
    if ($app) { Cleanup-AcceptanceProcess $port }
    if ($result.failures.Count -ne 0) { $result.success = $false }
    if ($evidence -and (Test-Path -LiteralPath $evidence)) { Save-Result $evidence }
}
if (-not $result.success) { Write-Error ($result.failures -join " | "); exit 1 }
