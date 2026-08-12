import { describe, expect, it } from "vitest";
import { DEFAULT_INSTALLED_RECOVERY_SCENARIO, parseInstalledRecoveryScenario, runInstalledRecoveryScenario } from "../scripts/windows/installed-webview2-recovery-scenario.js";

describe("installed recovery scenario contract", () => {
  it("is versioned, deterministic, and contains only constrained operations", () => {
    expect(parseInstalledRecoveryScenario(DEFAULT_INSTALLED_RECOVERY_SCENARIO)).toEqual(DEFAULT_INSTALLED_RECOVERY_SCENARIO);
    expect(() => parseInstalledRecoveryScenario({ ...DEFAULT_INSTALLED_RECOVERY_SCENARIO, javascript: "alert(1)" })).toThrow();
    expect(() => parseInstalledRecoveryScenario({ version: 1, name: "prompt-vault-installed-recovery", operations: [{ kind: "evaluate", expression: "document.body" }] })).toThrow();
  });

  it("compiles constrained operations into only fixed view calls", async () => {
    const calls: string[] = [];
    const view = {
      clickByRole: async (role: string, name: string) => { calls.push(`click:${role}:${name}`); },
      focusByRole: async () => undefined,
      setInputValueByLabel: async () => undefined,
      selectOptionByLabel: async () => undefined,
      setCheckedByRole: async () => undefined,
      dispatchKey: async () => undefined,
      headingText: async () => "Settings",
      assertNoHorizontalOverflow: async () => { calls.push("overflow"); },
      configureDownloadPath: async () => undefined,
      captureScreenshot: async () => undefined,
      accessibilityTree: async () => [{ role: "RootWebArea" }],
    };
    await expect(runInstalledRecoveryScenario({ view: view as never, evidencePath: "C:\\tmp\\scenario" })).resolves.toEqual([]);
    expect(calls).toEqual(["click:link:Settings", "click:button:Check historical database", "overflow"]);
  });
});
