[CmdletBinding()]
param([Parameter(Mandatory)][string]$OutputRoot, [Parameter(Mandatory)][string]$WixRoot)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sourceCommit = (& git -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[a-f0-9]{40}$') { throw 'Source identity unavailable.' }
$sourceStatus = @(& git -C $repo status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0 -or $sourceStatus.Count) { throw 'A clean committed source is required for authoritative media; commit the accepted implementation first.' }
if (Test-Path -LiteralPath $OutputRoot) { throw 'Build output must be new; existing media is protected.' }
$outputFull = [IO.Path]::GetFullPath($OutputRoot)
$tempFull = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
if (-not $outputFull.StartsWith($tempFull, [StringComparison]::OrdinalIgnoreCase)) { throw 'Only a disposable temp output root is supported.' }
$null = New-Item -ItemType Directory -Path $outputFull
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$upgrade = '{975929E8-18E6-44F5-BA40-157F667F18CD}'
foreach ($version in @('1.0.0', '1.1.0', '1.2.0', '1.3.0')) {
    $folder = Join-Path $outputFull $version
    $null = New-Item -ItemType Directory -Path $folder
    $assembly = Join-Path $folder 'AssemblyInfo.cs'
    @"
using System.Reflection;
[assembly: AssemblyTitle("Prompt Vault Update Acceptance")]
[assembly: AssemblyProduct("Prompt Vault Update Acceptance")]
[assembly: AssemblyVersion("$version.0")]
[assembly: AssemblyFileVersion("$version.0")]
[assembly: AssemblyInformationalVersion("$version")]
"@ | Set-Content -LiteralPath $assembly
    $exe = Join-Path $folder 'prompt-vault-update-acceptance.exe'
    & $compiler /nologo /target:winexe /platform:x64 /optimize+ "/out:$exe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll (Join-Path $PSScriptRoot 'SyntheticUpdateApp.cs') $assembly
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic fixture compilation failed.' }
    $selfTest = Start-Process -FilePath $exe -ArgumentList '--self-test' -PassThru -WindowStyle Hidden
    if (-not $selfTest.WaitForExit(30000)) { throw 'Synthetic SQLite self-test timed out; process retained for inspection.' }
    if ($selfTest.ExitCode -ne 0) { throw ('Synthetic SQLite self-test failed: ' + $selfTest.ExitCode) }
    $product = '{' + [Guid]::NewGuid().ToString().ToUpperInvariant() + '}'
    $package = '{' + [Guid]::NewGuid().ToString().ToUpperInvariant() + '}'
    $wxs = Join-Path $folder 'acceptance.wxs'
    $escapedExe = [Security.SecurityElement]::Escape($exe)
    @"
<?xml version="1.0" encoding="utf-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
 <Product Id="$product" Name="Prompt Vault Update Acceptance" Language="1033" Version="$version" Manufacturer="Nobody Production" UpgradeCode="$upgrade">
  <Package Id="$package" InstallerVersion="500" Compressed="yes" InstallScope="perMachine" Platform="x64" Description="Disposable synthetic MSI acceptance only" />
  <MajorUpgrade Schedule="afterInstallInitialize" DowngradeErrorMessage="Synthetic downgrade refused." />
  <MediaTemplate EmbedCab="yes" />
  <Property Id="PV_ACCEPTANCE_IDENTIFIER" Value="com.nobodyworld.promptvault.updateacceptance" />
  <Property Id="ARPNOMODIFY" Value="1" />
  <Property Id="ARPNOREPAIR" Value="1" />
  <Property Id="ARPINSTALLLOCATION"><![CDATA[INSTALLDIR]]></Property>
  <SetProperty Id="ARPINSTALLLOCATION" Value="[INSTALLDIR]" After="CostFinalize" />
  <Directory Id="TARGETDIR" Name="SourceDir">
   <Directory Id="ProgramFiles64Folder"><Directory Id="INSTALLDIR" Name="Prompt Vault Update Acceptance">
    <Component Id="AcceptanceExecutable" Guid="{E0768D63-1301-4647-A40A-51BF3F693190}" Win64="yes">
     <File Id="AcceptanceExe" Source="$escapedExe" KeyPath="yes">
      <Shortcut Id="AcceptanceShortcut" Directory="AcceptanceMenu" Name="Prompt Vault Update Acceptance" Advertise="yes" Arguments="--run" WorkingDirectory="INSTALLDIR" />
     </File>
     <RemoveFolder Id="AcceptanceMenuRemoval" Directory="AcceptanceMenu" On="uninstall" />
    </Component>
   </Directory></Directory>
   <Directory Id="ProgramMenuFolder"><Directory Id="AcceptanceMenu" Name="Prompt Vault Update Acceptance" /></Directory>
  </Directory>
  <Feature Id="Acceptance" Level="1"><ComponentRef Id="AcceptanceExecutable" /></Feature>
  <CustomActionRef Id="WixFailWhenDeferred" />
 </Product>
</Wix>
"@ | Set-Content -LiteralPath $wxs
    $object = Join-Path $folder 'acceptance.wixobj'
    & (Join-Path $WixRoot 'candle.exe') -nologo -arch x64 -out $object $wxs
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic MSI compile failed.' }
    $msi = Join-Path $folder 'acceptance.msi'
    & (Join-Path $WixRoot 'light.exe') -nologo -ext (Join-Path $WixRoot 'WixUtilExtension.dll') -out $msi $object
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic MSI link/validation failed.' }
    $manifest = @{
        manifestVersion = '1'; application = @{ identifier = 'com.nobodyworld.promptvault.updateacceptance'; version = $version; sourceCommit = $sourceCommit }
        artifact = @{ format = 'msi'; relativePath = 'acceptance.msi'; byteLength = (Get-Item -LiteralPath $msi).Length; sha256 = (Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash.ToLowerInvariant() }
        msi = @{ productCode = $product; upgradeCode = $upgrade; packageCode = $package; installScope = 'per-machine' }
        executable = @{ relativePath = 'prompt-vault-update-acceptance.exe'; fileVersion = "$version.0"; productVersion = $version; sha256 = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() }
        media = @{ cabinets = @() }
    }
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $folder 'manifest.json')
}
'Synthetic media built; no installer launched.'
