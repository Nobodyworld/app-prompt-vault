import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = resolve("scripts/windows/run-installed-webview2-acceptance.ps1");

describe("installed WebView2 PowerShell orchestration", () => {
  it("guards evidence and database paths, loopback, process identity, and cleanup", async () => {
    const script = await readFile(scriptPath, "utf8");
    expect(script).toContain("Assert-ExternalEvidencePath");
    expect(script).toContain("Assert-DisposablePath");
    expect(script).toContain("127.0.0.1");
    expect(script).toContain("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS");
    expect(script).toContain("WEBVIEW2_USER_DATA_FOLDER");
    expect(script).toContain("Prompt Vault is already running");
    expect(script).toContain("Test-DescendantProcess");
    expect(script).toContain("CloseMainWindow");
    expect(script).toContain("Loopback DevTools listener remained after cleanup");
  });

  it("does not use the installer refresh workflow", async () => {
    const script = await readFile(scriptPath, "utf8");
    expect(script).not.toContain("install-local-build.ps1");
    expect(script).not.toContain("msiexec.exe");
    expect(script).not.toContain("0.0.0.0");
  });
});
