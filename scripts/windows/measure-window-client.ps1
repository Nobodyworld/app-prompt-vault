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

    [StructLayout(LayoutKind.Sequential)]
    public struct Point
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct WindowPlacement
    {
        public uint Length;
        public uint Flags;
        public uint ShowCmd;
        public Point MinPosition;
        public Point MaxPosition;
        public Rect NormalPosition;
    }

    public static class WindowMetrics
    {
        public static readonly IntPtr DpiAwarenessContextPerMonitorAwareV2 =
            new IntPtr(-4);

        public const int SwRestore = 9;
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

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool IsZoomed(IntPtr hWnd);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetWindowPlacement(
            IntPtr hWnd,
            ref WindowPlacement placement
        );

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool ShowWindowAsync(IntPtr hWnd, int command);

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

function Convert-Rect([PromptVault.Rect]$Rect) {
    return [pscustomobject]@{
        Left = $Rect.Left
        Top = $Rect.Top
        Right = $Rect.Right
        Bottom = $Rect.Bottom
        Width = $Rect.Right - $Rect.Left
        Height = $Rect.Bottom - $Rect.Top
    }
}

function Get-ShowCommandName([uint32]$ShowCmd) {
    switch ($ShowCmd) {
        0 { return "Hide" }
        1 { return "Normal" }
        2 { return "ShowMinimized" }
        3 { return "ShowMaximized" }
        6 { return "Minimize" }
        7 { return "ShowMinNoActive" }
        9 { return "Restore" }
        11 { return "ForceMinimize" }
        default { return "Unknown" }
    }
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
    if ($dpi -eq 0) { $dpi = 96 }

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

function Get-WindowState {
    param(
        [IntPtr]$WindowHandle,
        [double]$ExpectedWidth,
        [double]$ExpectedHeight,
        [double]$Tolerance
    )

    $placement = [PromptVault.WindowPlacement]::new()
    $placement.Length = [Runtime.InteropServices.Marshal]::SizeOf(
        [type][PromptVault.WindowPlacement]
    )
    if (-not [PromptVault.WindowMetrics]::GetWindowPlacement(
        $WindowHandle,
        [ref]$placement
    )) {
        throw "GetWindowPlacement failed. $(Get-Win32ErrorMessage)"
    }

    $measurement = Get-WindowMeasurement `
        -WindowHandle $WindowHandle `
        -ExpectedWidth $ExpectedWidth `
        -ExpectedHeight $ExpectedHeight `
        -Tolerance $Tolerance
    $normalRect = Convert-Rect $placement.NormalPosition

    return [pscustomobject]@{
        WindowHandle = $WindowHandle.ToInt64()
        WindowHandleHex = "0x{0:X}" -f $WindowHandle.ToInt64()
        IsVisible = [PromptVault.WindowMetrics]::IsWindowVisible($WindowHandle)
        IsZoomed = [PromptVault.WindowMetrics]::IsZoomed($WindowHandle)
        IsIconic = [PromptVault.WindowMetrics]::IsIconic($WindowHandle)
        ShowCommand = $placement.ShowCmd
        ShowCommandName = Get-ShowCommandName $placement.ShowCmd
        NormalPosition = $normalRect
        Measurement = $measurement
    }
}

function Get-MeasurementEvidence([object]$State) {
    $measurement = $State.Measurement
    return [pscustomobject]@{
        WindowHandle = $State.WindowHandle
        WindowHandleHex = $State.WindowHandleHex
        IsVisible = $State.IsVisible
        IsZoomed = $State.IsZoomed
        IsIconic = $State.IsIconic
        ShowCommand = $State.ShowCommand
        ShowCommandName = $State.ShowCommandName
        NormalPosition = $State.NormalPosition
        Dpi = $measurement.Dpi
        ScaleFactor = [Math]::Round($measurement.ScaleFactor, 4)
        ClientPixels = [pscustomobject]@{
            Width = $measurement.ClientWidthPixels
            Height = $measurement.ClientHeightPixels
        }
        ClientLogical = [pscustomobject]@{
            Width = [Math]::Round($measurement.ClientWidthLogical, 4)
            Height = [Math]::Round($measurement.ClientHeightLogical, 4)
        }
        OuterPixels = [pscustomobject]@{
            Width = $measurement.OuterWidthPixels
            Height = $measurement.OuterHeightPixels
        }
        FrameDeltaPixels = [pscustomobject]@{
            Width = $measurement.FrameWidthPixels
            Height = $measurement.FrameHeightPixels
        }
        MeetsMinimum = $measurement.MeetsMinimum
        AtConfiguredMinimum = $measurement.AtConfiguredMinimum
    }
}

function Wait-ForStableMainWindow {
    param(
        [System.Diagnostics.Process]$Process,
        [double]$ExpectedWidth,
        [double]$ExpectedHeight,
        [double]$Tolerance,
        [int]$TimeoutMilliseconds = 30000,
        [int]$StableSampleCount = 3,
        [int]$SampleIntervalMilliseconds = 100
    )

    $watch = [Diagnostics.Stopwatch]::StartNew()
    $consecutiveStable = 0
    $previousKey = $null
    $samples = [Collections.Generic.List[object]]::new()

    while ($watch.ElapsedMilliseconds -lt $TimeoutMilliseconds) {
        $Process.Refresh()
        if ($Process.HasExited) {
            throw "Prompt Vault exited while waiting for its native main window."
        }

        $windowHandle = $Process.MainWindowHandle
        $title = $Process.MainWindowTitle
        if ($windowHandle -eq [IntPtr]::Zero -or [string]::IsNullOrWhiteSpace($title)) {
            $consecutiveStable = 0
            $previousKey = $null
            Start-Sleep -Milliseconds $SampleIntervalMilliseconds
            continue
        }

        try {
            $state = Get-WindowState `
                -WindowHandle $windowHandle `
                -ExpectedWidth $ExpectedWidth `
                -ExpectedHeight $ExpectedHeight `
                -Tolerance $Tolerance
        } catch {
            $consecutiveStable = 0
            $previousKey = $null
            Start-Sleep -Milliseconds $SampleIntervalMilliseconds
            continue
        }

        $measurement = $state.Measurement
        $ready =
            $state.IsVisible -and
            $measurement.ClientWidthPixels -gt 0 -and
            $measurement.ClientHeightPixels -gt 0 -and
            $measurement.OuterWidthPixels -gt 0 -and
            $measurement.OuterHeightPixels -gt 0
        if (-not $ready) {
            $consecutiveStable = 0
            $previousKey = $null
            Start-Sleep -Milliseconds $SampleIntervalMilliseconds
            continue
        }

        $evidence = Get-MeasurementEvidence $state
        $samples.Add([pscustomobject]@{
            ElapsedMilliseconds = $watch.ElapsedMilliseconds
            WindowTitle = $title
            Geometry = $evidence
        })
        if ($samples.Count -gt 10) { $samples.RemoveAt(0) }

        $key = "{0}:{1}:{2}:{3}:{4}" -f `
            $windowHandle.ToInt64(),
            $measurement.ClientWidthPixels,
            $measurement.ClientHeightPixels,
            $measurement.OuterWidthPixels,
            $measurement.OuterHeightPixels
        if ($key -eq $previousKey) {
            $consecutiveStable++
        } else {
            $previousKey = $key
            $consecutiveStable = 1
        }

        if ($consecutiveStable -ge $StableSampleCount) {
            $watch.Stop()
            return [pscustomobject]@{
                WindowHandle = $windowHandle
                WindowTitle = $title
                State = $state
                WaitedMilliseconds = $watch.ElapsedMilliseconds
                StableSampleCount = $consecutiveStable
                Samples = $samples.ToArray()
            }
        }

        Start-Sleep -Milliseconds $SampleIntervalMilliseconds
    }

    throw "Prompt Vault did not expose a visible, titled main window with stable nonzero geometry within $TimeoutMilliseconds ms."
}

if ($PSBoundParameters.ContainsKey("ProcessId")) {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
} else {
    $candidates = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)
    if ($candidates.Count -eq 0) {
        throw "No '$ProcessName' process was found. Launch Prompt Vault first."
    }
    if ($candidates.Count -gt 1) {
        $ids = $candidates.Id -join ", "
        throw "Multiple '$ProcessName' processes were found (PIDs: $ids). Re-run with -ProcessId."
    }
    $process = $candidates[0]
}

$previousDpiContext =
    [PromptVault.WindowMetrics]::SetThreadDpiAwarenessContext(
        [PromptVault.WindowMetrics]::DpiAwarenessContextPerMonitorAwareV2
    )
if ($previousDpiContext -eq [IntPtr]::Zero) {
    throw "SetThreadDpiAwarenessContext failed. $(Get-Win32ErrorMessage)"
}

try {
    $startup = Wait-ForStableMainWindow `
        -Process $process `
        -ExpectedWidth $ExpectedWidth `
        -ExpectedHeight $ExpectedHeight `
        -Tolerance $Tolerance
    $windowHandle = $startup.WindowHandle
    $measurement = $startup.State.Measurement
    $beforeRestore = Get-MeasurementEvidence $startup.State

    $restoreRequested = [bool]$ResizeToExpectedMinimum
    $restoreApiResult = $null
    $afterRestore = $beforeRestore
    if ($restoreRequested) {
        $restoreApiResult = [PromptVault.WindowMetrics]::ShowWindowAsync(
            $windowHandle,
            [PromptVault.WindowMetrics]::SwRestore
        )
        $restored = Wait-ForStableMainWindow `
            -Process $process `
            -ExpectedWidth $ExpectedWidth `
            -ExpectedHeight $ExpectedHeight `
            -Tolerance $Tolerance
        $windowHandle = $restored.WindowHandle
        $measurement = $restored.State.Measurement
        $afterRestore = Get-MeasurementEvidence $restored.State
        if ($restored.State.IsZoomed -or $restored.State.IsIconic) {
            throw "Prompt Vault did not reach restored state before resizing."
        }
    }

    $resizeAttempts = [Collections.Generic.List[object]]::new()
    $resizeApplied = $false
    $targetClientWidthPixels = $null
    $targetClientHeightPixels = $null
    $targetOuterWidthPixels = $null
    $targetOuterHeightPixels = $null

    if ($ResizeToExpectedMinimum) {
        $maximumAttempts = 3
        for ($attempt = 1; $attempt -le $maximumAttempts; $attempt++) {
            $ready = Wait-ForStableMainWindow `
                -Process $process `
                -ExpectedWidth $ExpectedWidth `
                -ExpectedHeight $ExpectedHeight `
                -Tolerance $Tolerance
            $windowHandle = $ready.WindowHandle
            $beforeState = $ready.State
            if ($beforeState.IsZoomed -or $beforeState.IsIconic) {
                [void][PromptVault.WindowMetrics]::ShowWindowAsync(
                    $windowHandle,
                    [PromptVault.WindowMetrics]::SwRestore
                )
                $ready = Wait-ForStableMainWindow `
                    -Process $process `
                    -ExpectedWidth $ExpectedWidth `
                    -ExpectedHeight $ExpectedHeight `
                    -Tolerance $Tolerance
                $windowHandle = $ready.WindowHandle
                $beforeState = $ready.State
            }

            $beforeMeasurement = $beforeState.Measurement
            $targetClientWidthPixels =
                [int][Math]::Ceiling($ExpectedWidth * $beforeMeasurement.ScaleFactor)
            $targetClientHeightPixels =
                [int][Math]::Ceiling($ExpectedHeight * $beforeMeasurement.ScaleFactor)
            $targetOuterWidthPixels =
                $targetClientWidthPixels + $beforeMeasurement.FrameWidthPixels
            $targetOuterHeightPixels =
                $targetClientHeightPixels + $beforeMeasurement.FrameHeightPixels
            $flags =
                [PromptVault.WindowMetrics]::SwpNoMove -bor
                [PromptVault.WindowMetrics]::SwpNoZOrder -bor
                [PromptVault.WindowMetrics]::SwpNoActivate

            $apiSucceeded = [PromptVault.WindowMetrics]::SetWindowPos(
                $windowHandle,
                [IntPtr]::Zero,
                0,
                0,
                $targetOuterWidthPixels,
                $targetOuterHeightPixels,
                $flags
            )
            if (-not $apiSucceeded) {
                throw "SetWindowPos failed. $(Get-Win32ErrorMessage)"
            }

            Start-Sleep -Milliseconds 500
            $afterReady = Wait-ForStableMainWindow `
                -Process $process `
                -ExpectedWidth $ExpectedWidth `
                -ExpectedHeight $ExpectedHeight `
                -Tolerance $Tolerance
            $windowHandle = $afterReady.WindowHandle
            $measurement = $afterReady.State.Measurement
            $resizeApplied = $true
            $resizeAttempts.Add([pscustomobject]@{
                Attempt = $attempt
                ApiSucceeded = $apiSucceeded
                RequestedClientPixels = [pscustomobject]@{
                    Width = $targetClientWidthPixels
                    Height = $targetClientHeightPixels
                }
                RequestedOuterPixels = [pscustomobject]@{
                    Width = $targetOuterWidthPixels
                    Height = $targetOuterHeightPixels
                }
                Before = Get-MeasurementEvidence $beforeState
                After = Get-MeasurementEvidence $afterReady.State
                ExactSizeResult = $measurement.AtConfiguredMinimum
            })

            if ($measurement.AtConfiguredMinimum) { break }
            Start-Sleep -Milliseconds 250
        }
    }

    $result = [pscustomobject]@{
        ProcessId = $process.Id
        ProcessName = $process.ProcessName
        ExecutablePath = $process.Path
        WindowTitle = $startup.WindowTitle
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
        Startup = [pscustomobject]@{
            WaitedMilliseconds = $startup.WaitedMilliseconds
            StableSampleCount = $startup.StableSampleCount
            Samples = $startup.Samples
        }
        Restore = [pscustomobject]@{
            Requested = $restoreRequested
            ApiResult = $restoreApiResult
            Before = $beforeRestore
            After = $afterRestore
            Restored = (-not $afterRestore.IsZoomed -and -not $afterRestore.IsIconic)
        }
        ResizeRequested = [bool]$ResizeToExpectedMinimum
        ResizeApplied = $resizeApplied
        RequestedClientPixels = if ($ResizeToExpectedMinimum) {
            [pscustomobject]@{
                Width = $targetClientWidthPixels
                Height = $targetClientHeightPixels
            }
        } else { $null }
        RequestedOuterPixels = if ($ResizeToExpectedMinimum) {
            [pscustomobject]@{
                Width = $targetOuterWidthPixels
                Height = $targetOuterHeightPixels
            }
        } else { $null }
        ResizeAttemptCount = $resizeAttempts.Count
        ResizeAttempts = $resizeAttempts.ToArray()
        MeetsMinimum = $measurement.MeetsMinimum
        AtConfiguredMinimum = $measurement.AtConfiguredMinimum
        ExactSizeResult = $measurement.AtConfiguredMinimum
    }

    if ($AsJson) {
        $result | ConvertTo-Json -Depth 10
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
