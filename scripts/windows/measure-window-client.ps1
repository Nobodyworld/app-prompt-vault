[CmdletBinding()]
param(
    [int]$ProcessId,
    [string]$ProcessName = "prompt-vault-app",
    [double]$ExpectedWidth = 400,
    [double]$ExpectedHeight = 600,
    [double]$Tolerance = 1.5,
    [switch]$RequireExactMinimum,
    [switch]$AsJson
)

$ErrorActionPreference = "Stop"

if (-not $IsWindows) {
    throw "This measurement utility is supported only on Windows."
}

if (-not ("PromptVault.WindowMetrics" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace PromptVault
{
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public static class WindowMetrics
    {
        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetClientRect(IntPtr hWnd, out Rect rect);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);

        [DllImport("user32.dll")]
        public static extern uint GetDpiForWindow(IntPtr hWnd);
    }
}
"@
}

function Get-Win32ErrorMessage {
    $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    return "Win32 error $code: $([ComponentModel.Win32Exception]::new($code).Message)"
}

if ($PSBoundParameters.ContainsKey("ProcessId")) {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
} else {
    $candidates = @(
        Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne 0 }
    )

    if ($candidates.Count -eq 0) {
        throw "No visible '$ProcessName' window was found. Launch Prompt Vault first."
    }

    if ($candidates.Count -gt 1) {
        $ids = ($candidates.Id -join ", ")
        throw "Multiple '$ProcessName' windows were found (PIDs: $ids). Re-run with -ProcessId."
    }

    $process = $candidates[0]
}

$process.Refresh()
$windowHandle = $process.MainWindowHandle
if ($windowHandle -eq 0) {
    throw "Process $($process.Id) does not currently expose a visible main window."
}

$clientRect = [PromptVault.Rect]::new()
if (-not [PromptVault.WindowMetrics]::GetClientRect($windowHandle, [ref]$clientRect)) {
    throw "GetClientRect failed. $(Get-Win32ErrorMessage)"
}

$outerRect = [PromptVault.Rect]::new()
if (-not [PromptVault.WindowMetrics]::GetWindowRect($windowHandle, [ref]$outerRect)) {
    throw "GetWindowRect failed. $(Get-Win32ErrorMessage)"
}

$dpi = [PromptVault.WindowMetrics]::GetDpiForWindow($windowHandle)
if ($dpi -eq 0) {
    $dpi = 96
}

$clientWidthPixels = $clientRect.Right - $clientRect.Left
$clientHeightPixels = $clientRect.Bottom - $clientRect.Top
$outerWidthPixels = $outerRect.Right - $outerRect.Left
$outerHeightPixels = $outerRect.Bottom - $outerRect.Top

$scale = 96.0 / [double]$dpi
$clientWidthLogical = $clientWidthPixels * $scale
$clientHeightLogical = $clientHeightPixels * $scale

$meetsMinimum =
    $clientWidthLogical -ge ($ExpectedWidth - $Tolerance) -and
    $clientHeightLogical -ge ($ExpectedHeight - $Tolerance)

$atMinimum =
    [Math]::Abs($clientWidthLogical - $ExpectedWidth) -le $Tolerance -and
    [Math]::Abs($clientHeightLogical - $ExpectedHeight) -le $Tolerance

$result = [pscustomobject]@{
    ProcessId = $process.Id
    ProcessName = $process.ProcessName
    Dpi = $dpi
    ScaleFactor = [Math]::Round($dpi / 96.0, 4)
    ClientPixels = "$clientWidthPixels x $clientHeightPixels"
    ClientLogical = "{0:N2} x {1:N2}" -f $clientWidthLogical, $clientHeightLogical
    OuterPixels = "$outerWidthPixels x $outerHeightPixels"
    ExpectedMinimumLogical = "{0:N2} x {1:N2}" -f $ExpectedWidth, $ExpectedHeight
    ToleranceLogical = $Tolerance
    MeetsMinimum = $meetsMinimum
    AtConfiguredMinimum = $atMinimum
}

if ($AsJson) {
    $result | ConvertTo-Json -Depth 3
} else {
    $result | Format-List
    Write-Host ""
    Write-Host "Tauri minWidth/minHeight apply to the logical inner client area, not the outer Win32 frame."
    if (-not $RequireExactMinimum) {
        Write-Host "For minimum-size acceptance, resize Prompt Vault to the smallest permitted size and run the exact-minimum command."
    }
}

if (-not $meetsMinimum) {
    Write-Error "The measured logical client area is below the configured minimum."
    exit 1
}

if ($RequireExactMinimum -and -not $atMinimum) {
    Write-Error "The window meets the minimum but is not currently within tolerance of the configured 400 x 600 logical minimum. Resize it to the smallest allowed size and retry."
    exit 1
}

exit 0
