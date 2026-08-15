import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = resolve("scripts/windows/run-installed-webview2-acceptance.ps1");
const installed = "C:\\Program Files\\Prompt Vault\\prompt-vault-app.exe";
const isWindows = process.platform === "win32";
const hash = existsSync(installed) ? createHash("sha256").update(readFileSync(installed)).digest("hex") : "0".repeat(64);
const safeRoot = `C:\\tmp\\prompt-vault-harness-script-test-${process.pid}`;

describe("installed WebView2 PowerShell orchestration", () => {
  it("parses with the PowerShell parser API", () => {
    if (!isWindows) return;
    const command = `$t=$null;$e=$null;[System.Management.Automation.Language.Parser]::ParseFile('${scriptPath.replaceAll("'", "''")}',[ref]$t,[ref]$e)|Out-Null;if($e.Count){$e|% ToString;exit 1}`;
    expect(() => execFileSync("pwsh", ["-NoProfile", "-Command", command], { encoding: "utf8" })).not.toThrow();
  });

  it("fails a hash mismatch before creating evidence, profiles, databases, listeners, or a process", () => {
    if (!isWindows || !existsSync(installed)) return;
    const result = spawnSync("pwsh", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-EvidencePath", safeRoot, "-CurrentDatabasePath", `${safeRoot}\\current\\prompt-vault.db`, "-LegacyDatabasePath", `${safeRoot}\\legacy\\prompt-vault.db`, "-InstalledExecutable", installed, "-ExpectedExecutableSha256", "0".repeat(64), "-ValidateOnly"], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(existsSync(safeRoot)).toBe(false);
  });

  it("validates distinct contained disposable paths without launching", () => {
    if (!isWindows || !existsSync(installed)) return;
    const result = spawnSync("pwsh", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-EvidencePath", safeRoot, "-CurrentDatabasePath", `${safeRoot}\\same\\prompt-vault.db`, "-LegacyDatabasePath", `${safeRoot}\\same\\prompt-vault.db`, "-InstalledExecutable", installed, "-ExpectedExecutableSha256", hash, "-ValidateOnly"], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(existsSync(safeRoot)).toBe(false);
  });

  it("contains fail-closed loopback, listener ownership, process cleanup, and no installer workflow", () => {
    const script = readFileSync(scriptPath, "utf8");
    expect(script).toContain("127.0.0.1");
    expect(script).toContain("Test-DescendantProcess");
    expect(script).toContain("WaitForExit(30000)");
    expect(script).toContain("forced-containment");
    expect(script).toContain("EvidencePath already exists");
    expect(script).not.toContain("install-local-build.ps1");
    expect(script).not.toContain("msiexec.exe");
  });

  it("keeps phase evidence path-safe while preserving declared persistence and source-absence checks", () => {
    const script = readFileSync(scriptPath, "utf8");
    expect(script).toContain("orchestrator-result.private.json");
    expect(script).toContain("orchestrator-result.json");
    expect(script).toContain("missing-wal");
    expect(script).toContain("missing-shm");
    expect(script).toContain("version-history-restart-verification");
    expect(script).toContain("$profileDirectories");
    expect(script).toContain("--fixture $fixturePath");
    expect(script).toContain("transition-verification.json");
  });
});
