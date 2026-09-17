[CmdletBinding()]
param([switch]$SyntheticAcceptance)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$targetExecutable = if ($SyntheticAcceptance) { 'prompt-vault-update-acceptance.exe' } else { 'prompt-vault-app.exe' }

# Private observations go to the parent process through stdout. Only its domain
# report is public. This collector never opens an installer session or app data.
Add-Type -Path (Join-Path $PSScriptRoot 'ReadOnlyMsi.cs')
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$errors = [Collections.Generic.List[string]]::new()
$locks = [Collections.Generic.List[IDisposable]]::new()
$scratch = [IO.Directory]::CreateTempSubdirectory('pv73-').FullName
$scratchCounter = 0

function Assert-PlainPath([string]$Path) {
    if ($Path -notmatch '^[A-Za-z]:\\' -or $Path.Substring(2).Contains(':')) { throw 'Local absolute path required.' }
    $item = Get-Item -Force -LiteralPath $Path
    $cursor = $item
    while ($null -ne $cursor) {
        if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point refused.' }
        $cursor = if ($cursor -is [IO.DirectoryInfo]) { $cursor.Parent } else { $cursor.Directory }
    }
    return $item
}

function Resolve-RecoveryIdentityPath([string]$Path) {
    # Do not guess at device, UNC, stream, short-name or trimmed-name aliases.
    # Unsupported or inaccessible paths leave recovery provenance unverified.
    $pathText = $Path.Replace('/', '\')
    if ($pathText -notmatch '^[A-Za-z]:\\' -or $pathText -cne $pathText.Trim() -or $pathText.Substring(2) -match '[\x00-\x1f"<>|?*:~]') { throw 'Unsupported identity path.' }
    foreach ($part in $pathText.Substring(3).Split('\')) {
        if (-not $part -or ($part -notin @('.', '..') -and $part -match '[. ]$')) { throw 'Ambiguous identity path.' }
    }
    $item = Assert-PlainPath ([IO.Path]::GetFullPath($pathText))
    if ($item.PSIsContainer) { throw 'Identity file required.' }
    return $item.FullName
}

function Get-RecoverySource([string]$RecoveryPath, [object[]]$Registrations) {
    if (-not $RecoveryPath) { return 'not-supplied' }
    try { $recoveryIdentity = Resolve-RecoveryIdentityPath $RecoveryPath } catch { return 'unverified' }
    $matched = $false; $unverified = $false; $compared = 0
    foreach ($registration in $Registrations) {
        foreach ($service in $registration.services) {
            try {
                $cacheIdentity = Resolve-RecoveryIdentityPath $service.localPackage
                $compared++
                if ([string]::Equals($recoveryIdentity, $cacheIdentity, [StringComparison]::OrdinalIgnoreCase)) { $matched = $true }
            } catch { $unverified = $true }
        }
    }
    if ($matched) { return 'installer-cache' }
    if ($unverified -or $compared -eq 0) { return 'unverified' }
    return 'independent-media'
}

function Read-File([string]$Path, [switch]$Executable) {
    $item = Assert-PlainPath $Path
    if ($item.PSIsContainer) { throw 'File required.' }
    $stream = [IO.File]::Open($item.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $locks.Add($stream)
    $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)).ToLowerInvariant()
    $result = @{ byteLength = $stream.Length; sha256 = $hash }
    if ($Executable) {
        $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($item.FullName)
        $result.fileVersion = '{0}.{1}.{2}.{3}' -f $version.FileMajorPart, $version.FileMinorPart, $version.FileBuildPart, $version.FilePrivatePart
        $result.productVersion = [string]$version.ProductVersion
        $result.path = $item.FullName
    }
    return $result
}

function Read-Msi([string]$Path, [switch]$Cached) {
    if ([IO.Path]::GetExtension($Path) -ine '.msi') { throw 'MSI required.' }
    $digest = Read-File $Path
    $db = [ReadOnlyMsi]::new($Path)
    try {
        $properties = @{}
        foreach ($row in $db.Query('SELECT `Property`, `Value` FROM `Property`')) { $properties[$row[0]] = $row[1] }
        $files = @($db.Query('SELECT `File`, `Component_`, `FileName`, `FileSize`, `Version`, `Attributes`, `Sequence` FROM `File`') | ForEach-Object {
            @{ key = $_[0]; component = $_[1]; name = $_[2]; size = [long]$_[3]; version = $_[4]; attributes = [int]$_[5]; sequence = [int]$_[6] }
        })
        $components = @($db.Query('SELECT `Component`, `Directory_` FROM `Component`') | ForEach-Object { @{ key = $_[0]; directory = $_[1] } })
        $directories = @($db.Query('SELECT `Directory`, `Directory_Parent`, `DefaultDir` FROM `Directory`') | ForEach-Object { @{ key = $_[0]; parent = $_[1]; name = $_[2] } })
        $media = @($db.Query('SELECT `DiskId`, `LastSequence`, `Cabinet` FROM `Media` ORDER BY `DiskId`') | ForEach-Object {
            @{ diskId = [int]$_[0]; lastSequence = [int]$_[1]; cabinet = $_[2]; digest = $null; members = @(); error = $null }
        })
        $wordCount = [int]$db.Summary(15)
        foreach ($medium in $media) {
            if ($Cached) { continue }
            try {
                $script:scratchCounter++
                $folder = Join-Path $scratch ('media-' + $script:scratchCounter)
                $null = [IO.Directory]::CreateDirectory($folder)
                $cabinet = [string]$medium.cabinet
                if ($cabinet.StartsWith('#')) {
                    $cabinetPath = Join-Path $folder 'embedded.cab'
                    $db.CopyStream($cabinet.Substring(1), $cabinetPath)
                } else {
                    # External media is confined to the selected MSI's directory.
                    if ($cabinet -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]*\.cab$' -or $cabinet.Contains('..')) { throw 'Unsupported media name.' }
                    $cabinetPath = Join-Path (Split-Path -Parent $Path) $cabinet
                }
                $medium.digest = Read-File $cabinetPath
                $previous = @($media | Where-Object { $_.diskId -lt $medium.diskId } | Select-Object -Last 1)
                $lower = if ($previous.Count -eq 0) { 0 } else { $previous[0].lastSequence }
                $members = @($files | Where-Object { $_.sequence -gt $lower -and $_.sequence -le $medium.lastSequence })
                foreach ($member in $members) {
                    if (($member.attributes -band 8192) -ne 0 -or (($member.attributes -band 16384) -eq 0 -and ($wordCount -band 2) -eq 0)) { throw 'Loose media unsupported.' }
                }
                $keys = [string[]]@($members | ForEach-Object { $_.key })
                $extracted = [ReadOnlyMsi]::ExtractCabinet($cabinetPath, $keys, $folder)
                $medium.members = @(for ($index = 0; $index -lt $members.Count; $index++) {
                    $info = Read-File $extracted[$index] -Executable
                    # Scratch paths are not installation identity.
                    $info.Remove('path')
                    @{ key = $keys[$index]; file = $info }
                })
            } catch { $medium.error = 'media-unreadable-or-unsupported' }
        }
        return @{
            digest = $digest; properties = $properties; packageCode = $db.Summary(9)
            template = $db.Summary(7); wordCount = $wordCount
            files = $files; components = $components; directories = $directories; media = $media
        }
    } finally { $db.Dispose() }
}

function Read-Registration([string]$Hive, [string]$Location, [string]$KeyName, [object]$Key) {
    $record = @{
        source = $Hive + '/' + $Location; key = $KeyName
        displayName = [string]$Key.GetValue('DisplayName', '')
        displayVersion = [string]$Key.GetValue('DisplayVersion', '')
        publisher = [string]$Key.GetValue('Publisher', '')
        installLocation = [string]$Key.GetValue('InstallLocation', '')
        displayIcon = [string]$Key.GetValue('DisplayIcon', '')
        windowsInstaller = [string]$Key.GetValue('WindowsInstaller', '')
        services = @(); cachedMsi = $null; executable = $null; errors = @()
    }
    $contexts = if ($Hive -eq 'HKLM') { @(4) } else { @(1, 2) }
    foreach ($context in $contexts) {
        try {
            $cache = [ReadOnlyMsi]::ProductInfo($KeyName, $context, 'LocalPackage')
            $record.services += @{
                context = $context; localPackage = $cache
                version = [ReadOnlyMsi]::ProductInfo($KeyName, $context, 'VersionString')
                packageCode = [ReadOnlyMsi]::ProductInfo($KeyName, $context, 'PackageCode')
                installLocation = [ReadOnlyMsi]::ProductInfo($KeyName, $context, 'InstallLocation')
            }
        } catch {
            $cause = $_.Exception
            while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
            if ($cause -isnot [ComponentModel.Win32Exception] -or $cause.NativeErrorCode -ne 1605) { $record.errors += 'installer-registration-unreadable' }
        }
    }
    if ($record.services.Count -eq 1) {
        try { $record.cachedMsi = Read-Msi $record.services[0].localPackage -Cached } catch { $record.errors += 'cached-identity-unreadable' }
    }
    if ($record.installLocation) {
        try { $record.executable = Read-File (Join-Path $record.installLocation $targetExecutable) -Executable } catch { $record.errors += 'installed-executable-unreadable' }
    }
    return $record
}

try {
    $selected = $null; $recovery = $null; $procedure = $null
    try { $selected = Read-Msi $request.selectedPath } catch { $errors.Add('selected-msi-unreadable') }
    if ($request.recoveryPath) {
        try { $recovery = Read-Msi $request.recoveryPath } catch { $errors.Add('recovery-msi-unreadable') }
    }
    if ($request.procedurePath) {
        try {
            if ([IO.Path]::GetExtension($request.procedurePath) -notin @('.md', '.txt')) { throw 'Procedure document required.' }
            $procedure = Read-File $request.procedurePath
        } catch { $errors.Add('recovery-procedure-unreadable') }
    }
    $relatedProducts = @()
    if ($null -ne $selected -and $selected.properties.ContainsKey('UpgradeCode')) {
        try { $relatedProducts = @([ReadOnlyMsi]::RelatedProducts($selected.properties.UpgradeCode)) } catch { $errors.Add('related-products-unreadable') }
    }
    $registrations = @()
    $roots = @()
    foreach ($hive in @('HKCU', 'HKLM')) {
        $hiveId = if ($hive -eq 'HKLM') { [Microsoft.Win32.RegistryHive]::LocalMachine } else { [Microsoft.Win32.RegistryHive]::CurrentUser }
        foreach ($location in @('Software\Microsoft\Windows\CurrentVersion\Uninstall', 'Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
            $source = $hive + '/' + $location
            $base = $null; $root = $null
            try {
                $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hiveId, [Microsoft.Win32.RegistryView]::Registry64)
                $root = $base.OpenSubKey($location, $false)
                if ($null -ne $root) {
                    foreach ($name in $root.GetSubKeyNames()) {
                        $key = $root.OpenSubKey($name, $false)
                        try {
                            $display = [string]$key.GetValue('DisplayName', '')
                            $install = [string]$key.GetValue('InstallLocation', '')
                            $candidate = if ($SyntheticAcceptance) { $display -eq 'Prompt Vault Update Acceptance' -or $install -match '(?i)prompt vault update acceptance' } else { $display -match '(?i)prompt[ -]*vault' -or $install -match '(?i)prompt[ -]*vault' }
                            if ($candidate -or $name -in $relatedProducts -or ($null -ne $selected -and $name -eq $selected.properties.ProductCode)) {
                                $registrations += Read-Registration $hive $location $name $key
                            }
                        } finally { if ($null -ne $key) { $key.Dispose() } }
                    }
                }
                $roots += $source
            } catch { $errors.Add('registry-root-unreadable') }
            finally { if ($null -ne $root) { $root.Dispose() }; if ($null -ne $base) { $base.Dispose() } }
        }
    }
    $recoverySource = Get-RecoverySource $request.recoveryPath $registrations
    $processes = @()
    try {
        foreach ($process in Get-CimInstance -ClassName Win32_Process -Property Name, ProcessId, ExecutablePath) {
            $path = [string]$process.ExecutablePath
            $underInstall = @($registrations | Where-Object { $_.installLocation -and $path.StartsWith($_.installLocation.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
            if ($process.Name -ieq $targetExecutable -or $underInstall) {
                $file = $null
                if ($path) { try { $file = Read-File $path -Executable } catch { $errors.Add('process-executable-unreadable') } }
                $processes += @{ pid = [int]$process.ProcessId; path = $path; file = $file }
            }
        }
    } catch { $errors.Add('process-inventory-unreadable') }
    $evidence = @{ schemaVersion = 1; selected = $selected; recovery = $recovery; recoverySource = $recoverySource; procedure = $procedure; roots = $roots; relatedProducts = $relatedProducts; registrations = $registrations; processes = $processes; errors = @($errors) }
} finally {
    foreach ($handle in $locks) { $handle.Dispose() }
    # Only generated cabinet/payload files live here. Fail closed before deletion.
    $scratchFull = [IO.Path]::GetFullPath($scratch)
    $tempFull = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $scratchFull.StartsWith($tempFull, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $scratchFull) -notlike 'pv73-*') { throw 'Scratch ownership failed.' }
    $items = @((Get-Item -LiteralPath $scratchFull)) + @(Get-ChildItem -LiteralPath $scratchFull -Force -Recurse)
    foreach ($item in $items) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Scratch link refused.' }
        if (-not $item.PSIsContainer -and $item.Name -notmatch '^(embedded\.cab|payload-\d+\.bin)$') { throw 'Unknown scratch file retained.' }
    }
    Remove-Item -LiteralPath $scratchFull -Recurse -ErrorAction Stop
    if (Test-Path -LiteralPath $scratchFull) { throw 'Scratch cleanup incomplete.' }
}
$evidence | ConvertTo-Json -Depth 30 -Compress
