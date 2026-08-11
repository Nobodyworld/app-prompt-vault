[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$EvidencePath,
    [Parameter(Mandatory = $true)][string]$CurrentDatabasePath,
    [Parameter(Mandatory = $true)][string]$LegacyDatabasePath,
    [string]$InstalledExecutable = "C:\Program Files\Prompt Vault\prompt-vault-app.exe",
    [ValidateSet("self-test")][string]$Scenario = "self-test"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$result = [ordered]@{ success=$false; port=$null; processId=$null; listenerProcessId=$null; scenario=$Scenario; failure=$null }
$evidence = $null

function Assert-ExternalEvidencePath([string]$Path) {
    if (-not [IO.Path]::IsPathFullyQualified($Path)) { throw "EvidencePath must be absolute." }
    $resolved = [IO.Path]::GetFullPath($Path)
    if (-not $resolved.StartsWith("C:\tmp\", [StringComparison]::OrdinalIgnoreCase)) { throw "EvidencePath must be under C:\tmp." }
    if ($resolved.StartsWith($repoRoot.Path, [StringComparison]::OrdinalIgnoreCase)) { throw "EvidencePath must not be inside the repository." }
    return $resolved
}

function Assert-DisposablePath([string]$Path, [string]$Name) {
    $resolved = [IO.Path]::GetFullPath($Path)
    if (-not $resolved.StartsWith("C:\tmp\", [StringComparison]::OrdinalIgnoreCase)) { throw "$Name must be disposable and under C:\tmp." }
    if ($resolved -match "(?i)com\.nobodyworld\.promptvault|com\.promptvault\.desktop") { throw "$Name points at a protected application-data location." }
    return $resolved
}

function Get-FreeLoopbackPort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse("127.0.0.1"), 0)
    try { $listener.Start(); return ([Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
}

function Get-LoopbackListener([int]$Port) {
    @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq "127.0.0.1" })
}

function Test-DescendantProcess([int]$ProcessId, [int]$AncestorId) {
    $current = $ProcessId
    for ($attempt = 0; $attempt -lt 24; $attempt++) {
        if ($current -eq $AncestorId) { return $true }
        $row = Get-CimInstance Win32_Process -Filter "ProcessId=$current" -ErrorAction SilentlyContinue
        if (-not $row -or -not $row.ParentProcessId) { return $false }
        $current = [int]$row.ParentProcessId
    }
    return $false
}

function Wait-DevTools([int]$Port, [int]$AppProcessId) {
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while ([DateTime]::UtcNow -lt $deadline) {
        $listeners = Get-LoopbackListener $Port
        if ($listeners.Count -eq 1 -and (Test-DescendantProcess $listeners[0].OwningProcess $AppProcessId)) {
            try {
                $version = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
                if ($version.Browser) { return $listeners[0] }
            } catch { }
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Loopback DevTools endpoint did not become ready with one verified child listener."
}

function Save-Result([string]$EvidenceDirectory) {
    [pscustomobject]$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $EvidenceDirectory "orchestrator-result.json")
}

$app = $null
try {
    $evidence = Assert-ExternalEvidencePath $EvidencePath
    $currentDb = Assert-DisposablePath $CurrentDatabasePath "CurrentDatabasePath"
    $legacyDb = Assert-DisposablePath $LegacyDatabasePath "LegacyDatabasePath"
    if (-not (Test-Path -LiteralPath $InstalledExecutable)) { throw "Installed executable was not found." }
    $alreadyRunning = @(Get-Process -Name "prompt-vault-app" -ErrorAction SilentlyContinue)
    if ($alreadyRunning.Count -ne 0) { throw "Prompt Vault is already running; close it normally before the installed acceptance harness starts." }
    New-Item -ItemType Directory -Force -Path $evidence | Out-Null
    $webViewData = Join-Path $evidence "webview2-user-data"
    New-Item -ItemType Directory -Force -Path $webViewData | Out-Null
    $port = Get-FreeLoopbackPort
    $result.port = $port
    $startInfo = [Diagnostics.ProcessStartInfo]::new($InstalledExecutable)
    $startInfo.UseShellExecute = $false
    $startInfo.Environment["PROMPT_VAULT_DB_PATH"] = $currentDb
    $startInfo.Environment["PROMPT_VAULT_LEGACY_DB_PATH"] = $legacyDb
    $startInfo.Environment["PROMPT_VAULT_TELEMETRY_OPTOUT"] = "1"
    $startInfo.Environment["NW_TELEMETRY_OPTOUT"] = "1"
    $startInfo.Environment["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=$port"
    $startInfo.Environment["WEBVIEW2_USER_DATA_FOLDER"] = $webViewData
    $app = [Diagnostics.Process]::Start($startInfo)
    if (-not $app) { throw "Installed Prompt Vault process did not start." }
    $result.processId = $app.Id
    $listener = Wait-DevTools $port $app.Id
    $result.listenerProcessId = $listener.OwningProcess
    Push-Location $repoRoot
    try {
        & pnpm tsx scripts/windows/installed-webview2-cdp.ts --port $port --evidence $evidence
        if ($LASTEXITCODE -ne 0) { throw "CDP self-test failed with exit code $LASTEXITCODE." }
    } finally { Pop-Location }
    $result.success = $true
} catch { $result.failure = $_.Exception.Message } finally {
    if ($app -and -not $app.HasExited) { $null = $app.CloseMainWindow(); $null = $app.WaitForExit(30000) }
    if ($result.port) {
        $remaining = Get-LoopbackListener ([int]$result.port)
        if ($remaining.Count -ne 0) { $result.success = $false; $result.failure = "Loopback DevTools listener remained after cleanup." }
    }
    if ($evidence) { Save-Result $evidence }
}

if (-not $result.success) { Write-Error $result.failure; exit 1 }
