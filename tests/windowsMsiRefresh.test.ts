import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const modulePath = resolve("scripts/windows/install-local-build-core.psm1");
const scriptPath = resolve("scripts/windows/install-local-build.ps1");
const hasPowerShell = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0;

function psLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function runPowerShell(body: string): string {
  const command = `$ErrorActionPreference='Stop';Import-Module ${psLiteral(modulePath)} -Force;${body}`;
  const encoded = Buffer.from(command, "utf16le").toString("base64");
  const result = spawnSync("pwsh", ["-NoProfile", "-EncodedCommand", encoded], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`.trim());
  return result.stdout.trim();
}

function errorFrom(body: string): string {
  return runPowerShell(`try{${body};'NO_ERROR'}catch{$_.Exception.Message}`);
}

function jsonFrom<T>(body: string): T {
  return JSON.parse(runPowerShell(`$value=&{${body}};$value|ConvertTo-Json -Depth 20 -Compress`)) as T;
}

const productCode = "{B29AF4F7-C1D2-4AFD-BCD1-2408DA969346}";

describe("guarded Windows MSI refresh", () => {
  it("parses both PowerShell sources with the parser API", () => {
    if (!hasPowerShell) return;
    const files = [modulePath, scriptPath].map(psLiteral).join(",");
    expect(runPowerShell(`foreach($file in @(${files})){$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){throw ($errors|% Message)}};'parsed'`)).toBe("parsed");
    const source = readFileSync(scriptPath, "utf8");
    expect(source).toContain("$selectedModes = @(@(");
    expect(source).toContain("$packages = @()");
  });

  it("models HKCU, HKLM, and WOW6432Node registration discovery", () => {
    const source = readFileSync(scriptPath, "utf8");
    expect(source).toContain("HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*");
    expect(source).toContain("HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*");
    expect(source).toContain("HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*");
    expect(source).toContain('Get-ObjectPropertyValue $_ "DisplayName"');
  });

  it("classifies a single per-user or per-machine registration", () => {
    if (!hasPowerShell) return;
    const result = jsonFrom<{ user: { Scope: string; ProductCode: string }; machine: { Scope: string } }>(`$base=@{DisplayName='Prompt Vault';PSChildName='${productCode}';UninstallString='msiexec /x ${productCode}';QuietUninstallString=''};$user=Resolve-PromptVaultRegistration @([pscustomobject]($base+@{Scope='PerUser'}));$machine=Resolve-PromptVaultRegistration @([pscustomobject]($base+@{Scope='PerMachine'}));[pscustomobject]@{user=$user;machine=$machine}`);
    expect(result.user).toMatchObject({ Scope: "PerUser", ProductCode: productCode });
    expect(result.machine.Scope).toBe("PerMachine");
  });

  it("rejects duplicate registrations instead of choosing the first", () => {
    if (!hasPowerShell) return;
    const message = errorFrom(`$records=@([pscustomobject]@{DisplayName='Prompt Vault';Scope='PerUser';PSChildName='${productCode}'},[pscustomobject]@{DisplayName='Prompt Vault';Scope='PerMachine';PSChildName='${productCode}'});Resolve-PromptVaultRegistration $records`);
    expect(message).toContain("duplicate or ambiguous");
  });

  it("validates product codes and rejects conflicting identifiers", () => {
    if (!hasPowerShell) return;
    expect(runPowerShell(`Get-MsiProductCode ([pscustomobject]@{PSChildName='';UninstallString='MsiExec.exe /X${productCode}';QuietUninstallString=''})`)).toBe(productCode);
    expect(errorFrom(`ConvertTo-CanonicalProductCodeValue '{not-a-guid}'`)).toContain("canonical braced GUID");
    expect(errorFrom(`Get-MsiProductCode ([pscustomobject]@{PSChildName='${productCode}';UninstallString='msiexec /x {00000000-0000-0000-0000-000000000001}';QuietUninstallString=''})`)).toContain("ambiguous MSI product codes");
  });

  it("requires elevation only for a non-elevated per-machine registration", () => {
    if (!hasPowerShell) return;
    const result = jsonFrom<Array<{ Scope: string; ElevationRequired: boolean }>>(`@((Get-ElevationDisposition PerUser $false),(Get-ElevationDisposition PerMachine $false),(Get-ElevationDisposition PerMachine $true))`);
    expect(result.map((item) => item.ElevationRequired)).toEqual([false, true, false]);
    const source = readFileSync(scriptPath, "utf8");
    expect(source).toContain("[Security.Principal.WindowsIdentity]::GetCurrent()");
    expect(source).toContain("WindowsBuiltInRole]::Administrator");
  });

  it("fails before MSI for a non-elevated per-machine refresh without reviewed continuation", () => {
    if (!hasPowerShell) return;
    const starts = runPowerShell(`$script:starts=0;try{Assert-MsiStartAllowed PerMachine $false $false $false;$script:starts++}catch{};$script:starts`);
    expect(starts).toBe("0");
    expect(errorFrom(`Assert-MsiStartAllowed PerMachine $false $true $false`)).toContain("not elevated; no MSI process");
  });

  it("rejects an active MSI transaction without starting or retrying", () => {
    if (!hasPowerShell) return;
    const starts = runPowerShell(`$script:starts=0;try{Assert-MsiStartAllowed PerUser $false $false $true;$script:starts++}catch{};$script:starts`);
    expect(starts).toBe("0");
    expect(errorFrom(`Assert-MsiStartAllowed PerUser $false $false $true`)).toContain("active Windows Installer transaction");
  });

  it("validates fresh external evidence paths and rejects unsafe locations", () => {
    if (!hasPowerShell) return;
    expect(runPowerShell(String.raw`Assert-EvidencePathContract 'C:\tmp\prompt-vault-msi-test' 'C:\repo' $false $false`)).toBe("C:\\tmp\\prompt-vault-msi-test");
    expect(errorFrom(String.raw`Assert-EvidencePathContract 'relative\evidence' 'C:\repo' $false $false`)).toContain("absolute local Windows");
    expect(errorFrom(String.raw`Assert-EvidencePathContract 'C:\repo\evidence' 'C:\repo' $false $false`)).toContain("beneath C:\\tmp");
    expect(errorFrom(String.raw`Assert-EvidencePathContract 'C:\tmp\existing' 'C:\repo' $true $false`)).toContain("already exists");
    expect(errorFrom(String.raw`Assert-EvidencePathContract 'C:\tmp\linked' 'C:\repo' $false $true`)).toContain("reparse point");
  });

  it("extracts only an exact executable path from DisplayIcon metadata", () => {
    if (!hasPowerShell) return;
    expect(runPowerShell(String.raw`Get-DisplayIconExecutablePath '"C:\Program Files\Prompt Vault\prompt-vault-app.exe",0'`)).toBe("C:\\Program Files\\Prompt Vault\\prompt-vault-app.exe");
    expect(runPowerShell(String.raw`Get-DisplayIconExecutablePath 'C:\Prompt Vault\prompt-vault-app.exe, -3'`)).toBe("C:\\Prompt Vault\\prompt-vault-app.exe");
    expect(runPowerShell(`$value=Get-DisplayIconExecutablePath 'not-an-executable';if($null -eq $value){'NONE'}`)).toBe("NONE");
  });

  it("creates and validates a strict versioned continuation manifest", () => {
    if (!hasPowerShell) return;
    const result = jsonFrom<{ schemaVersion: number; purpose: string; scriptSha256: string; coreModuleSha256: string; valid: boolean }>(String.raw`$hash='A'*64;$msi=[pscustomobject]@{path='C:\repo\bundle\Prompt Vault.msi';sha256=$hash;size=10;signatureStatus='NotSigned'};$exe=[pscustomobject]@{path='C:\repo\target\prompt-vault-app.exe';sha256=$hash;size=20};$installed=[pscustomobject]@{path='C:\Program Files\Prompt Vault\prompt-vault-app.exe';sha256=$hash;size=20};$now=[DateTimeOffset]::Parse('2026-08-15T00:00:00Z');$manifest=New-ContinuationManifestData 'C:\repo' 'C:\repo\scripts\install.ps1' 'C:\tmp\evidence' '${productCode}' 900 30 $msi $exe $installed $hash 'C:\repo\scripts\core.psm1' $hash $now;$valid=Test-ContinuationManifestData $manifest $hash $hash $now $false;[pscustomobject]@{schemaVersion=$manifest.schemaVersion;purpose=$manifest.purpose;scriptSha256=$manifest.scriptSha256;coreModuleSha256=$manifest.coreModuleSha256;valid=$valid}`);
    expect(result).toEqual({ schemaVersion: 1, purpose: "prompt-vault-local-msi-refresh", scriptSha256: "A".repeat(64), coreModuleSha256: "A".repeat(64), valid: true });
  });

  it("requires an exact MSI-only candidate pairing receipt", () => {
    if (!hasPowerShell) return;
    const prefix = `$hash='A'*64;$msi=[pscustomobject]@{name='Prompt Vault.msi';size=10;sha256=$hash};$exe=[pscustomobject]@{name='prompt-vault-app.exe';size=20;sha256=$hash};$receipt=[ordered]@{schemaVersion=1;purpose='prompt-vault-msi-refresh-candidate';createdAtUtc='2026-08-15T00:00:00Z';candidateMsi=[ordered]@{name=$msi.name;size=$msi.size;sha256=$hash};candidateExecutable=[ordered]@{name=$exe.name;size=$exe.size;sha256=$hash}};`;
    expect(runPowerShell(`${prefix}Test-CandidateReceiptData $receipt $msi $exe`)).toBe("True");
    expect(errorFrom(`${prefix}$exe.sha256='B'*64;Test-CandidateReceiptData $receipt $msi $exe`)).toContain("no longer matches the MSI-only build receipt");
  });

  it("rejects continuation-manifest tampering, expiry, and replay", () => {
    if (!hasPowerShell) return;
    const prefix = String.raw`$hash='A'*64;$other='B'*64;$msi=[pscustomobject]@{path='C:\repo\bundle\Prompt Vault.msi';sha256=$hash;size=10;signatureStatus='NotSigned'};$exe=[pscustomobject]@{path='C:\repo\target\prompt-vault-app.exe';sha256=$hash;size=20};$installed=[pscustomobject]@{path='C:\Program Files\Prompt Vault\prompt-vault-app.exe';sha256=$hash;size=20};$now=[DateTimeOffset]::Parse('2026-08-15T00:00:00Z');$manifest=New-ContinuationManifestData 'C:\repo' 'C:\repo\scripts\install.ps1' 'C:\tmp\evidence' '${productCode}' 900 30 $msi $exe $installed $hash 'C:\repo\scripts\core.psm1' $hash $now;`;
    expect(errorFrom(`${prefix}Test-ContinuationManifestData $manifest $hash $other $now $false`)).toContain("hash mismatch");
    expect(errorFrom(`${prefix}Test-ContinuationManifestData $manifest $hash $hash $now $true`)).toContain("already been consumed");
    expect(errorFrom(`${prefix}Test-ContinuationManifestData $manifest $hash $hash $now.AddHours(1) $false`)).toContain("expired");
  });

  it("returns an explicit, reviewable elevation command", () => {
    if (!hasPowerShell) return;
    const command = runPowerShell(String.raw`New-ElevationCommand 'C:\repo\install-local-build.ps1' 'C:\tmp\evidence\manifest.json' ('A'*64)`);
    expect(command).toContain("-RequestElevation");
    expect(command).toContain("-ContinuationManifest 'C:\\tmp\\evidence\\manifest.json'");
    expect(command).toContain("-ExpectedManifestSha256");
  });

  it.each([
    ["Uninstall", 0, "", true, "success"],
    ["Uninstall", 1605, "", true, "already-absent"],
    ["Install", 1605, "", false, "install-product-unavailable"],
    ["Install", 1618, "", false, "installer-busy"],
    ["Install", 3010, "", true, "success-reboot-required"],
    ["Uninstall", 1603, "Error 1730. You must be an Administrator.", false, "administrator-required"],
    ["Install", 1603, "fatal error", false, "fatal-1603"],
    ["Install", 42, "", false, "unknown-exit-code"],
  ])("classifies %s MSI exit %i", (operation, exitCode, log, success, category) => {
    if (!hasPowerShell) return;
    const result = jsonFrom<{ Success: boolean; Category: string }>(`Get-MsiExitDisposition ${operation} ${exitCode} ${psLiteral(log)}`);
    expect(result).toMatchObject({ Success: success, Category: category });
  });

  it("times out MSI without invoking a kill action", () => {
    if (!hasPowerShell) return;
    const message = errorFrom(`$process=[pscustomobject]@{ExitCode=0};Wait-MsiProcessBounded $process 30 {param($candidate,$seconds)$false}`);
    expect(message).toContain("left running");
    const core = readFileSync(modulePath, "utf8");
    expect(core).not.toMatch(/Stop-Process|\.Kill\s*\(/);
  });

  it("does not start install after a failed uninstall", () => {
    if (!hasPowerShell) return;
    const result = runPowerShell(`$script:installs=0;try{Invoke-MsiRefreshSequence { [pscustomobject]@{Success=$false;Message='uninstall failed'} } { $script:installs++;[pscustomobject]@{Success=$true;Message='ok'} }}catch{};$script:installs`);
    expect(result).toBe("0");
  });

  it("uses exact identity and graceful bounded close without force", () => {
    if (!hasPowerShell) return;
    const success = jsonFrom<{ Closed: boolean; Method: string }>(String.raw`$record=[pscustomobject]@{Id=7;StartTimeUtc='2026-08-15T00:00:00Z';Path='C:\app.exe'};Invoke-GracefulPromptVaultClose @($record) {param($p)$true} {param($p)$true}`);
    expect(success).toMatchObject({ Closed: true, Method: "graceful" });
    expect(errorFrom(`$record=[pscustomobject]@{Id=7};Invoke-GracefulPromptVaultClose @($record) {param($p)$true} {param($p)$false}`)).toContain("no force kill");
    expect(errorFrom(`Invoke-GracefulPromptVaultClose @([pscustomobject]@{Id=1},[pscustomobject]@{Id=2}) {param($p)$true} {param($p)$true}`)).toContain("ambiguous");
    expect(errorFrom(String.raw`Assert-ProcessIdentity ([pscustomobject]@{Id=1;StartTimeUtc='a';Path='C:\app.exe'}) ([pscustomobject]@{Id=1;StartTimeUtc='b';Path='C:\app.exe'})`)).toContain("identity changed");
    expect(runPowerShell(String.raw`Assert-ProcessExecutablePath 'C:\Program Files\Prompt Vault\prompt-vault-app.exe' 'c:\Program Files\Prompt Vault\prompt-vault-app.exe'`)).toBe("True");
    expect(errorFrom(String.raw`Assert-ProcessExecutablePath 'C:\Program Files\Prompt Vault\prompt-vault-app.exe' 'C:\tmp\prompt-vault-app.exe'`)).toContain("graceful close is ambiguous");
  });

  it("classifies simulated UAC cancellation without retrying", () => {
    if (!hasPowerShell) return;
    expect(errorFrom(`Invoke-ExplicitElevationRequest { throw [ComponentModel.Win32Exception]::new(1223) }`)).toContain("canceled; no MSI continuation");
  });

  it("accepts equal protected inventories and rejects any mismatch", () => {
    if (!hasPowerShell) return;
    expect(runPowerShell(`$inventory=[pscustomobject]@{'current-db'=[pscustomobject]@{exists=$true;size=10;sha256='abc'}};Compare-ProtectedInventories $inventory $inventory`)).toBe("True");
    expect(errorFrom(`$before=[pscustomobject]@{'current-db'=[pscustomobject]@{exists=$true;size=10;sha256='abc'}};$after=[pscustomobject]@{'current-db'=[pscustomobject]@{exists=$true;size=11;sha256='def'}};Compare-ProtectedInventories $before $after`)).toContain("Protected file changed");
  });

  it("verifies candidate and installed executable identity", () => {
    if (!hasPowerShell) return;
    expect(runPowerShell(`Assert-ExecutableIdentity ('A'*64) ('a'*64) 'candidate'`)).toBe("True");
    expect(errorFrom(`Assert-ExecutableIdentity ('A'*64) ('B'*64) 'installed executable'`)).toContain("does not match");
  });

  it("keeps real effects behind the entry script and defaults to no launch", () => {
    const core = readFileSync(modulePath, "utf8");
    const script = readFileSync(scriptPath, "utf8");
    expect(core).not.toMatch(/Get-ItemProperty|msiexec\.exe|Start-Process\s+-FilePath\s+"prompt-vault-app/);
    expect(script).toContain('Mutex]::OpenExisting("Global\\_MSIExecute")');
    expect(script).toContain("/L*V");
    expect(script).toContain("Wait-MsiProcessBounded");
    expect(script).toContain("& pnpm tauri:build -- --bundles msi");
    expect(script).toContain("prompt-vault-msi-refresh-candidate.v1.private.json");
    expect(script).toContain("if ($Launch)");
    expect(script).not.toContain("Stop-Process");
    expect(script).not.toMatch(/-FilePath\s+"msiexec\.exe"[^\n]*-Wait/);
    expect(script).not.toMatch(/better-sqlite3|sqlite3|Microsoft\.Data\.Sqlite/i);
  });

  it("writes detailed private evidence and a redacted safe summary", () => {
    const script = readFileSync(scriptPath, "utf8");
    expect(script).toContain("elevation-continuation.v1.private.json");
    expect(script).toContain("preflight.private.json");
    expect(script).toContain("msi-uninstall.private.log");
    expect(script).toContain("msi-install.private.log");
    expect(script).toContain("refresh-result.private.json");
    expect(script).toContain("refresh-summary.json");
    expect(script).toContain("privatePathsRedacted = $true");
  });
});
