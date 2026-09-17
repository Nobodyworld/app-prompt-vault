[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -Path (Join-Path $PSScriptRoot 'SyntheticWindowClose.cs')
$script:passed = 0
function Window([uint32]$OwnerPid = 42, [long]$Handle = 123, [string]$Class = 'WindowsForms10.Window.fixture', [bool]$Visible = $false, [long]$Owner = 0, [uint32]$Thread = 7) {
    $w = [SyntheticWindowClose+Window]::new()
    $w.ProcessId = $OwnerPid; $w.Handle = $Handle; $w.ClassName = $Class
    $w.Visible = $Visible; $w.Owner = $Owner; $w.ThreadId = $Thread
    return $w
}
function Check([string]$Name, [object[]]$Windows, [long]$Expected = 0) {
    $chosen = [SyntheticWindowClose]::Select(42, [SyntheticWindowClose+Window[]]$Windows)
    $actual = if ($null -eq $chosen) { 0 } else { $chosen.Handle }
    if ($actual -ne $Expected) { throw "$Name selected an unsafe or unexpected handle: $actual" }
    $script:passed++
}
Check 'one hidden frame' @((Window)) 123
Check 'no frame' @()
Check 'wrong PID' @((Window -OwnerPid 43))
Check 'other PID ignored' @((Window -OwnerPid 43), (Window)) 123
Check 'two frames refuse' @((Window), (Window -Handle 456))
Check 'duplicate handle refuses' @((Window), (Window))
Check 'visible frame refuses' @((Window -Visible $true))
Check 'owned dialog refuses' @((Window -Owner 456))
Check 'null handle refuses' @((Window -Handle 0))
Check 'broadcast handle refuses' @((Window -Handle 65535))
Check 'missing thread refuses' @((Window -Thread 0))
Check 'unknown window refuses' @((Window), (Window -Handle 456 -Class 'Unknown'))
Check 'framework support only is insufficient' @((Window -Class 'GDI+ Hook Window Class'))
Check 'known framework supports coexist' @((Window), (Window -Handle 456 -Class '.NET-BroadcastEventWindow.fixture'), (Window -Handle 789 -Class 'GDI+ Hook Window Class'), (Window -Handle 234 -Class 'IME' -Owner 123)) 123
Check 'visible support is unexpected' @((Window), (Window -Handle 456 -Class 'IME' -Visible $true))
Check 'class comparison is ordinal' @((Window -Class 'windowsforms10.window.fixture'))
if ([SyntheticWindowClose]::Select(0, @((Window))) -ne $null) { throw 'Zero PID accepted' }; $script:passed++
if (-not [SyntheticWindowClose]::Same((Window), (Window))) { throw 'Stable window rejected' }; $script:passed++
foreach ($changed in @((Window -OwnerPid 43), (Window -Handle 456), (Window -Thread 8), (Window -Owner 456), (Window -Visible $true), (Window -Class 'Other'))) {
    if ([SyntheticWindowClose]::Same((Window), $changed)) { throw 'Changed window identity accepted' }
    $script:passed++
}
"PASS: $script:passed deterministic synthetic window selection/revalidation checks; no native messages sent."
