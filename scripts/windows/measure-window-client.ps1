[CmdletBinding()]
param(
    [int]$ProcessId,
    [string]$ProcessName = "prompt-vault-app",
    [double]$ExpectedWidth = 400,
    [double]$ExpectedHeight = 600,
    [double]$Tolerance = 1.5,
    [switch]$ResizeToExpectedMinimum,
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
        public static readonly IntPtr DpiAwarenessContextPerMonitorAwareV2 =
            new IntPtr(-4);

        public const uint SwpNoMove = 0x0002;
        public const uint SwpNoZOrder = 0x0004;
        public const uint SwpNoActivate = 0x0010;

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr SetThreadDpiAwarenessContext(
            IntPtr dpiContext
        );

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetClientRect(IntPtr hWnd, out Rect rect);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);

        [DllImport("user32.dll")]
        public static extern uint GetDpiForWindow(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetWindowPos(
            IntPtr hWnd,
            IntPtr hWndInsertAfter,
            int x,
            int y,
            int width,
            int height,
            uint flags
        );
    }
}
"@
}

function Get-Win32ErrorMessage {
    $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    return "Win32 error ${code}: $([System.ComponentModel.Win32Exception]::new($code).Message)"
}

function Get-WindowMeasurement {
    param(
        [IntPtr]$WindowHandle,
        [double]$ExpectedWidth,
        [double]$ExpectedHeight,
        [double]$Tolerance
    )

    $clientRect = [PromptVault.Rect]::new()
    if (-not [PromptVault.WindowMetrics]::GetClientRect(
        $WindowHandle,
        [ref]$clientRect
    )) {
        throw "GetClientRect failed. $(Get-Win32ErrorMessage)"
    }

    $outerRect = [PromptVault.Rect]::new()
    if (-not [PromptVault.WindowMetrics]::GetWindowRect(
        $WindowHandle,
        [ref]$outerRect
    )) {
        throw "GetWindowRect failed. $(Get-Win32ErrorMessage)"
    }

    $dpi = [PromptVault.WindowMetrics]::GetDpiForWindow($WindowHandle)
    if ($dpi -eq 0) {
        $dpi = 96
    }

    $clientWidthPixels = $clientRect.Right - $clientRect.Left
    $clientHeightPixels = $clientRect.Bottom - $clientRect.Top
    $outerWidthPixels = $outerRect.Right - $outerRect.Left
    $outerHeightPixels = $outerRect.Bottom - $outerRect.Top

    $scaleFactor = $dpi / 96.0
    $clientWidthLogical = $clientWidthPixels / $scaleFactor
    $clientHeightLogical = $clientHeightPixels / $scaleFactor

    return [pscustomobject]@{
        Dpi = $dpi
        ScaleFactor = $scaleFactor
        ClientWidthPixels = $clientWidthPixels
        ClientHeightPixels = $clientHeightPixels
        ClientWidthLogical = $clientWidthLogical
        ClientHeightLogical = $clientHeightLogical
        OuterWidthPixels = $outerWidthPixels
        OuterHeightPixels = $outerHeightPixels
        FrameWidthPixels = $outerWidthPixels - $clientWidthPixels
        FrameHeightPixels = $outerHeightPixels - $clientHeightPixels
        MeetsMinimum =
            $clientWidthLogical -ge ($ExpectedWidth - $Tolerance) -and
            $clientHeightLogical -ge ($ExpectedHeight - $Tolerance)
        AtConfiguredMinimum =
            [Math]::Abs($clientWidthLogical - $ExpectedWidth) -le $Tolerance -and
            [Math]::Abs($clientHeightLogical - $ExpectedHeight) -le $Tolerance
    }
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

$previousDpiContext =
    [PromptVault.WindowMetrics]::SetThreadDpiAwarenessContext(
        [PromptVault.WindowMetrics]::DpiAwarenessContextPerMonitorAwareV2
    )
if ($previousDpiContext -eq [IntPtr]::Zero) {
    throw "SetThreadDpiAwarenessContext failed. $(Get-Win32ErrorMessage)"
}

try {
    $measurement = Get-WindowMeasurement `
        -WindowHandle $windowHandle `
        -ExpectedWidth $ExpectedWidth `
        -ExpectedHeight $ExpectedHeight `
        -Tolerance $Tolerance

    $resizeApplied = $false
    if ($ResizeToExpectedMinimum) {
        $targetClientWidthPixels =
            [int][Math]::Ceiling($ExpectedWidth * $measurement.ScaleFactor)
        $targetClientHeightPixels =
            [int][Math]::Ceiling($ExpectedHeight * $measurement.ScaleFactor)
        $targetOuterWidthPixels =
            $targetClientWidthPixels + $measurement.FrameWidthPixels
        $targetOuterHeightPixels =
            $targetClientHeightPixels + $measurement.FrameHeightPixels
        $flags =
            [PromptVault.WindowMetrics]::SwpNoMove -bor
            [PromptVault.WindowMetrics]::SwpNoZOrder -bor
            [PromptVault.WindowMetrics]::SwpNoActivate

        if (-not [PromptVault.WindowMetrics]::SetWindowPos(
            $windowHandle,
            [IntPtr]::Zero,
            0,
            0,
            $targetOuterWidthPixels,
            $targetOuterHeightPixels,
            $flags
        )) {
            throw "SetWindowPos failed. $(Get-Win32ErrorMessage)"
        }

        Start-Sleep -Milliseconds 500
        $resizeApplied = $true
        $process.Refresh()
        $windowHandle = $process.MainWindowHandle
        if ($windowHandle -eq 0) {
            throw "Prompt Vault stopped exposing a visible main window after resizing."
        }

        $measurement = Get-WindowMeasurement `
            -WindowHandle $windowHandle `
            -ExpectedWidth $ExpectedWidth `
            -ExpectedHeight $ExpectedHeight `
            -Tolerance $Tolerance
    }

    $result = [pscustomobject]@{
        ProcessId = $process.Id
        ProcessName = $process.ProcessName
        CallerDpiAwareness = "PerMonitorAwareV2"
        Dpi = $measurement.Dpi
        ScaleFactor = [Math]::Round($measurement.ScaleFactor, 4)
        ClientPixels =
            "$($measurement.ClientWidthPixels) x $($measurement.ClientHeightPixels)"
        ClientLogical =
            "{0:N2} x {1:N2}" -f
                $measurement.ClientWidthLogical,
                $measurement.ClientHeightLogical
        OuterPixels =
            "$($measurement.OuterWidthPixels) x $($measurement.OuterHeightPixels)"
        ExpectedMinimumLogical =
            "{0:N2} x {1:N2}" -f $ExpectedWidth, $ExpectedHeight
        ToleranceLogical = $Tolerance
        ResizeRequested = [bool]$ResizeToExpectedMinimum
        ResizeApplied = $resizeApplied
        MeetsMinimum = $measurement.MeetsMinimum
        AtConfiguredMinimum = $measurement.AtConfiguredMinimum
    }

    if ($AsJson) {
        $result | ConvertTo-Json -Depth 3
    } else {
        $result | Format-List
        Write-Host ""
        Write-Host "The caller thread is forced to per-monitor DPI awareness before Win32 geometry is read."
        Write-Host "Tauri minWidth/minHeight apply to the logical inner client area, not the outer Win32 frame."
        if (-not $RequireExactMinimum) {
            Write-Host "For exact minimum-size acceptance, run pnpm desktop:accept-window-minimum."
        }
    }

    if (-not $measurement.MeetsMinimum) {
        Write-Error "The measured logical client area is below the configured minimum."
        exit 1
    }

    if ($RequireExactMinimum -and -not $measurement.AtConfiguredMinimum) {
        Write-Error "The window meets the minimum but is not currently within tolerance of the configured 400 x 600 logical minimum."
        exit 1
    }

    exit 0
} finally {
    [void][PromptVault.WindowMetrics]::SetThreadDpiAwarenessContext(
        $previousDpiContext
    )
}
