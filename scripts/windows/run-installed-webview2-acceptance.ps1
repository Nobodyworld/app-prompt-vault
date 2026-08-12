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
$result = [ordered]@{ success=$false; scenario=$Scenario; attempts=@(); cleanup="not-started"; failures=@() }
$evidence = $null
$app = $null

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
    @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { Test-DescendantProcess $_.ProcessId $RootProcessId } | ForEach-Object { [pscustomobject]@{ ProcessId=[int]$_.ProcessId; ParentProcessId=[int]$_.ParentProcessId; CreationDate=[string]$_.CreationDate; Name=[string]$_.Name; CommandLine=[string]$_.CommandLine } })
}
function Test-RecordedProcessAlive($Record) {
    $row = Get-CimInstance Win32_Process -Filter "ProcessId=$($Record.ProcessId)" -ErrorAction SilentlyContinue
    return $row -and ([string]$row.CreationDate -eq [string]$Record.CreationDate) -and ([string]$row.Name -ieq [string]$Record.Name)
}
function Get-ProfileUsers([string]$ProfilePath) {
    @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($ProfilePath, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { [pscustomobject]@{ ProcessId=[int]$_.ProcessId; ParentProcessId=[int]$_.ParentProcessId; CreationDate=[string]$_.CreationDate; Name=[string]$_.Name; CommandLine=[string]$_.CommandLine } })
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
function Get-KeyedInventory([hashtable]$Paths) {
    $inventory=[ordered]@{}
    foreach($key in $Paths.Keys){$inventory[$key]=Get-FileInventory $Paths[$key]}
    return $inventory
}
function Compare-KeyedInventory([hashtable]$Before, [hashtable]$Paths, [string]$Name) {
    foreach($key in $Paths.Keys){$after=Get-FileInventory $Paths[$key];if(($Before[$key]|ConvertTo-Json -Compress) -ne ($after|ConvertTo-Json -Compress)){throw "$Name changed: $key"}}
}
function Get-ProtectedPathMap { [ordered]@{ "current-db"="$env:LOCALAPPDATA\com.nobodyworld.promptvault\prompt-vault.db"; "current-wal"="$env:LOCALAPPDATA\com.nobodyworld.promptvault\prompt-vault.db-wal"; "current-shm"="$env:LOCALAPPDATA\com.nobodyworld.promptvault\prompt-vault.db-shm"; "historical-db"="$env:LOCALAPPDATA\com.promptvault.desktop\prompt-vault.db"; "historical-wal"="$env:LOCALAPPDATA\com.promptvault.desktop\prompt-vault.db-wal"; "historical-shm"="$env:LOCALAPPDATA\com.promptvault.desktop\prompt-vault.db-shm" } }
function Save-ProtectedBaselines([string]$EvidenceDirectory, [hashtable]$Inventory) { $Inventory | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $EvidenceDirectory "protected-database-baseline.private.json"); $safe=[ordered]@{};foreach($key in $Inventory.Keys){$safe[$key]=$Inventory[$key]};$safe|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $EvidenceDirectory "protected-database-baseline.safe.json") }
function Invoke-DisposableDatabaseVerification([string]$DatabasePath, [string]$EvidenceDirectory, [string]$Phase) {
    if (-not (Test-Path -LiteralPath $DatabasePath -PathType Leaf)) { throw "Disposable current database was not created for phase $Phase." }
    Push-Location $repoRoot
    try { $json=& pnpm tsx scripts/windows/verify-installed-webview2-database.ts --database $DatabasePath; if($LASTEXITCODE -ne 0){throw "Disposable database verification failed for phase $Phase."}; $verification=$json|ConvertFrom-Json; if($verification.integrity -ne "ok" -or $verification.foreignKeyViolations -ne 0){throw "Disposable database verification rejected phase $Phase."}; $verification|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $EvidenceDirectory "database-$Phase.json") } finally { Pop-Location }
}
function Complete-Attempt($Attempt, [bool]$Retrying) {
    $failures=[System.Collections.Generic.List[string]]::new()
    $late=Get-ProcessTree $Attempt.ProcessId
    $Attempt.Processes=@($Attempt.Processes+$late|Sort-Object ProcessId -Unique)
    $rootRecord=@($Attempt.Processes|Where-Object {$_.ProcessId -eq $Attempt.ProcessId}|Select-Object -First 1)
    if($rootRecord.Count -ne 1){$failures.Add("Attempt $($Attempt.Number) has no exact root identity record.")}elseif(Test-RecordedProcessAlive $rootRecord[0]){$root=Get-Process -Id $Attempt.ProcessId -ErrorAction SilentlyContinue;if(-not $root){$failures.Add("Attempt $($Attempt.Number) root identity disappeared before graceful close.")}else{$null=$root.CloseMainWindow();if(-not $root.WaitForExit(30000)){$Attempt.ShutdownMethod="forced-containment";$failures.Add("Attempt $($Attempt.Number) root did not exit gracefully.");foreach($record in $Attempt.Processes){if(Test-RecordedProcessAlive $record){Stop-Process -Id $record.ProcessId -Force -ErrorAction SilentlyContinue}}}else{$Attempt.ShutdownMethod="graceful"}}}else{$Attempt.ShutdownMethod="already-exited"}
    Start-Sleep -Milliseconds 250
    $lateAfter=Get-ProcessTree $Attempt.ProcessId
    foreach($record in @($Attempt.Processes+$lateAfter|Sort-Object ProcessId -Unique)){if(Test-RecordedProcessAlive $record){$failures.Add("Attempt $($Attempt.Number) process remains: $($record.ProcessId)")}}
    if((Get-LoopbackListeners $Attempt.Port).Count -ne 0){$failures.Add("Attempt $($Attempt.Number) loopback listener remains.")}
    foreach($profileUser in Get-ProfileUsers $Attempt.WebViewProfile){$failures.Add("Attempt $($Attempt.Number) process still references disposable WebView2 profile: $($profileUser.ProcessId)")}
    $Attempt.ShutdownFailures=@($failures)
    if($failures.Count -ne 0){foreach($failure in $failures){Add-Failure $failure};if($Retrying){throw "Attempt cleanup failed; retry is prohibited."}}
    return $failures.Count -eq 0
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
    New-Item -ItemType Directory -Path (Split-Path -Parent $currentDb) -ErrorAction Stop | Out-Null
    Push-Location $repoRoot
    try { $fixtureResult=& pnpm tsx scripts/windows/installed-webview2-fixtures.ts --evidence $evidence --legacy $legacyDb; if($LASTEXITCODE -ne 0){throw "Synthetic recovery fixture generation failed."}; $fixtureResult|Set-Content -LiteralPath (Join-Path $evidence "fixture-summary.private.json"); $fixture=$fixtureResult|ConvertFrom-Json; $safeBackups=[ordered]@{};foreach($property in $fixture.backups.PSObject.Properties){$safeBackups[$property.Name]=[ordered]@{sha256=$property.Value.sha256}};$safeFixture=[ordered]@{legacy=[ordered]@{promptCount=$fixture.legacy.promptCount;versionCount=$fixture.legacy.versionCount;tagCount=$fixture.legacy.tagCount;relationshipCount=$fixture.legacy.relationshipCount};backups=$safeBackups};$safeFixture|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $evidence "fixture-summary.json") } finally { Pop-Location }
    if(-not (Test-Path -LiteralPath $legacyDb -PathType Leaf)){throw "Synthetic legacy fixture was not created at the asserted LegacyDatabasePath."}
    $protectedPaths=Get-ProtectedPathMap
    $protectedBaseline=Get-KeyedInventory $protectedPaths
    Save-ProtectedBaselines $evidence $protectedBaseline
    $legacyPaths=[ordered]@{ "legacy-db"=$legacyDb; "legacy-wal"="$legacyDb-wal"; "legacy-shm"="$legacyDb-shm" }
    $legacyBaseline=Get-KeyedInventory $legacyPaths
    $phaseNames=if($Scenario -eq "recovery"){@("self-test","storage-status","missing-legacy-source","compatible-legacy-inspection","explicit-legacy-restore","backup-2-export-and-verify","backup-1-preview-and-cancel","skip-existing","add-missing-versions","import-as-copy","cancellation","stale-plan-rejection","version-history-preview","version-history-revert","restart-verification","final-database-verification")}else{@("self-test")}
    $phaseIndex=0
    foreach($phase in $phaseNames){
      $phaseIndex++
      $listener=$null;$app=$null;$attemptRecord=$null
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $port = Get-FreeLoopbackPort
        $webViewData=Join-Path $evidence "webview2-user-data-attempt-$phaseIndex-retry-$attempt"
        if(Test-Path -LiteralPath $webViewData){throw "Fresh WebView2 profile path already exists."}
        New-Item -ItemType Directory -Path $webViewData -ErrorAction Stop | Out-Null
        $activeLegacyDb=if($phase -eq "missing-legacy-source"){Join-Path $evidence "missing-legacy\prompt-vault.db"}else{$legacyDb}
        $startInfo = [Diagnostics.ProcessStartInfo]::new($candidate.Path); $startInfo.UseShellExecute = $false
        $startInfo.Environment["PROMPT_VAULT_DB_PATH"] = $currentDb; $startInfo.Environment["PROMPT_VAULT_LEGACY_DB_PATH"] = $activeLegacyDb
        $startInfo.Environment["PROMPT_VAULT_TELEMETRY_OPTOUT"] = "1"; $startInfo.Environment["NW_TELEMETRY_OPTOUT"] = "1"
        $startInfo.Environment["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=$port"
        $startInfo.Environment["WEBVIEW2_USER_DATA_FOLDER"] = $webViewData
        $app = [Diagnostics.Process]::Start($startInfo); if (-not $app) { throw "Installed Prompt Vault process did not start." }
        $attemptRecord=[pscustomobject]@{ Number=$phaseIndex; Phase=$phase; Retry=$attempt; ProcessId=$app.Id; CreationTimeUtc=$app.StartTime.ToUniversalTime().ToString("o"); Port=$port; Listener=$null; Processes=@(); WebViewProfile=$webViewData; ShutdownMethod="not-started"; ShutdownFailures=@() }
        $attemptRecord.Processes=Get-ProcessTree $app.Id
        $result.attempts += $attemptRecord
        try { $listener = Wait-DevTools $port $app.Id; $attemptRecord.Listener=[pscustomobject]@{ProcessId=$listener.OwningProcess;Port=$port;CreationDate=(Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue).CreationDate}; $attemptRecord.Processes=Get-ProcessTree $app.Id; break } catch { $launchFailure=$_.Exception.Message; $complete=Complete-Attempt $attemptRecord ($attempt -lt 3); if(-not $complete){throw}; if ($attempt -eq 3) { throw $launchFailure } }
    }
    $measureScript = Join-Path $repoRoot "scripts\windows\measure-window-client.ps1"
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $measureScript -ProcessId $app.Id -ResizeToExpectedMinimum -RequireExactMinimum -AsJson | Set-Content -LiteralPath (Join-Path $evidence "window-minimum.json")
    if ($LASTEXITCODE -ne 0) { throw "Exact 400x600 window measurement failed." }
    Push-Location $repoRoot
    try { & pnpm tsx scripts/windows/installed-webview2-cdp.ts --port $port --evidence $evidence --scenario $Scenario --phase $phase; if ($LASTEXITCODE -ne 0) { throw "CDP $Scenario/$phase phase failed with exit code $LASTEXITCODE." } } finally { Pop-Location }
    Compare-KeyedInventory $protectedBaseline $protectedPaths "Protected database"
    Compare-KeyedInventory $legacyBaseline $legacyPaths "Disposable legacy source"
    if(-not (Complete-Attempt $attemptRecord $false)){throw "Acceptance attempt cleanup failed."}
    Invoke-DisposableDatabaseVerification $currentDb $evidence $phase
    $app=$null
    }
    Compare-KeyedInventory $protectedBaseline $protectedPaths "Protected database final"
    Compare-KeyedInventory $legacyBaseline $legacyPaths "Disposable legacy source final"
    $result.success = $true
} catch { Add-Failure $_.Exception.Message; $result.success = $false } finally {
    if ($app -and $attemptRecord) { $null=Complete-Attempt $attemptRecord $false }
    if ($protectedBaseline -and $protectedPaths) { try { Compare-KeyedInventory $protectedBaseline $protectedPaths "Protected database final" } catch { Add-Failure $_.Exception.Message } }
    if ($legacyBaseline -and $legacyPaths) { try { Compare-KeyedInventory $legacyBaseline $legacyPaths "Disposable legacy source final" } catch { Add-Failure $_.Exception.Message } }
    if ($currentDb -and $evidence -and (Test-Path -LiteralPath $currentDb -PathType Leaf)) { try { Invoke-DisposableDatabaseVerification $currentDb $evidence "final" } catch { Add-Failure $_.Exception.Message } }
    if ($result.failures.Count -ne 0) { $result.success = $false }
    if ($evidence -and (Test-Path -LiteralPath $evidence)) { Save-Result $evidence }
}
if (-not $result.success) { Write-Error ($result.failures -join " | "); exit 1 }
