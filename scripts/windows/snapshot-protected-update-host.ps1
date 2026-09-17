[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# Hash-only preservation evidence. Never open a real database through SQLite.
$inputJson = @{ selectedPath = $null; recoveryPath = $null; procedurePath = $null } | ConvertTo-Json -Compress
$observed = $inputJson | & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -NonInteractive -File (Join-Path $PSScriptRoot 'collect-update-evidence.ps1') | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or @($observed.errors | Where-Object { $_ -ne 'selected-msi-unreadable' }).Count) { throw 'Protected identity inventory incomplete.' }
$realRegistrations = @($observed.registrations | Where-Object { $_.displayName -ne 'Prompt Vault Update Acceptance' })
$realProcesses = @($observed.processes | Where-Object { $_.path -notlike '*\Prompt Vault Update Acceptance\*' })
$roots = @()
foreach ($base in @([Environment]::GetFolderPath('LocalApplicationData'), [Environment]::GetFolderPath('ApplicationData'))) {
    foreach ($name in @('com.nobodyworld.promptvault', 'com.promptvault.desktop')) { $roots += Join-Path $base $name }
}
foreach ($registration in $realRegistrations) { if ($registration.installLocation) { $roots += $registration.installLocation.TrimEnd('\') } }
if ($env:PROMPT_VAULT_LEGACY_DB_PATH) { $roots += $env:PROMPT_VAULT_LEGACY_DB_PATH }
foreach ($base in @([Environment]::GetFolderPath('CommonPrograms'), [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonDesktopDirectory'), [Environment]::GetFolderPath('DesktopDirectory'))) {
    $roots += Join-Path $base 'Prompt Vault'; $roots += Join-Path $base 'Prompt Vault.lnk'
}
$files = [Collections.Generic.List[object]]::new()
function Inspect-Path([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { $files.Add(@{ path = $Path; exists = $false }); return }
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Protected inventory contains a link; explicit inventory required.' }
    if ($item.PSIsContainer) {
        $files.Add(@{ path = $Path; exists = $true; directory = $true })
        foreach ($child in Get-ChildItem -LiteralPath $Path -Force | Sort-Object Name) { Inspect-Path $child.FullName }
    } else {
        $files.Add(@{ path = $Path; exists = $true; directory = $false; bytes = $item.Length; sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() })
    }
}
foreach ($root in $roots | Sort-Object -Unique) { Inspect-Path $root }
@{ registrations = $realRegistrations; processes = $realProcesses; files = @($files) } | ConvertTo-Json -Depth 30 -Compress
