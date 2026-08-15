import { describe, expect, it } from "vitest";
import { DEFAULT_INSTALLED_RECOVERY_SCENARIO, installedRecoveryPhaseSchema, parseInstalledRecoveryScenario, runInstalledRecoveryScenario } from "../scripts/windows/installed-webview2-recovery-scenario.js";

describe("installed recovery scenario contract", () => {
  it("is versioned, deterministic, and contains only constrained operations", () => {
    expect(parseInstalledRecoveryScenario(DEFAULT_INSTALLED_RECOVERY_SCENARIO)).toEqual(DEFAULT_INSTALLED_RECOVERY_SCENARIO);
    expect(() => parseInstalledRecoveryScenario({ ...DEFAULT_INSTALLED_RECOVERY_SCENARIO, javascript: "alert(1)" })).toThrow();
    expect(() => parseInstalledRecoveryScenario({ version: 1, name: "prompt-vault-installed-recovery", operations: [{ kind: "evaluate", expression: "document.body" }] })).toThrow();
  });

  it("covers every repository-owned recovery acceptance phase exactly once", () => {
    const expected = installedRecoveryPhaseSchema.options;
    expect(DEFAULT_INSTALLED_RECOVERY_SCENARIO.phases.map((phase) => phase.phase)).toEqual(expected);
    expect(DEFAULT_INSTALLED_RECOVERY_SCENARIO.phases.every((phase) => phase.operations.length > 0)).toBe(true);
    expect(JSON.stringify(DEFAULT_INSTALLED_RECOVERY_SCENARIO)).not.toMatch(/javascript|expression|selector|planId|fingerprint/i);
  });

  it("compiles constrained operations into only fixed view calls", async () => {
    const calls: string[] = [];
    const view = {
      clickByRole: async (role: string, name: string) => { calls.push(`click:${role}:${name}`); },
      focusByRole: async () => undefined,
      waitForByRole: async () => undefined,
      setInputValueByLabel: async () => undefined,
      selectOptionByLabel: async () => undefined,
      setCheckedByRole: async () => undefined,
      dispatchKey: async () => undefined,
      headingText: async () => "Settings",
      assertText: async () => undefined,
      waitForText: async () => undefined,
      assertLiveRegion: async () => undefined,
      waitForLiveRegion: async () => undefined,
      assertRoute: async () => undefined,
      assertNoHorizontalOverflow: async () => { calls.push("overflow"); },
      configureDownloadPath: async () => undefined,
      observeDownloadNames: () => ({ names: () => [], dispose: () => undefined }),
      captureScreenshot: async () => undefined,
      uploadFileByLabel: async () => undefined,
      accessibilityTree: async () => [{ role: "RootWebArea" }],
      versionAction: async () => undefined,
      assertVersionHistory: async () => undefined,
      assertLastBackupMetadata: async () => undefined,
    };
    await expect(runInstalledRecoveryScenario({ view: view as never, evidencePath: "C:\\tmp\\scenario", phase: "self-test" })).resolves.toEqual([
      { phase: "self-test", operation: "click", outcome: "passed", details: { role: "link" } },
      { phase: "self-test", operation: "heading", outcome: "passed" },
      { phase: "self-test", operation: "overflow", outcome: "passed" },
      { phase: "self-test", operation: "accessibility", outcome: "passed", details: { nodeCount: 1 } },
      { phase: "self-test", operation: "screenshot", outcome: "passed" },
    ]);
    expect(calls).toEqual(["click:link:Settings", "overflow"]);
  });

  it("mutates after preview and attempts stale execution before requiring a new preview", async () => {
    const order: string[] = [];
    const view = {
      clickByRole: async (_role: string, name: string) => { order.push(`click:${name}`); }, focusByRole: async () => undefined, waitForByRole: async () => undefined, setInputValueByLabel: async () => undefined, selectOptionByLabel: async () => undefined, setCheckedByRole: async () => undefined, dispatchKey: async () => undefined, headingText: async () => "Settings", assertText: async () => undefined, waitForText: async (value: string) => { order.push(`wait:${value}`); }, assertLiveRegion: async () => undefined, waitForLiveRegion: async (value: string) => { order.push(`live:${value}`); }, assertRoute: async () => undefined, assertNoHorizontalOverflow: async () => undefined, configureDownloadPath: async () => undefined, observeDownloadNames: () => ({ names: () => [], dispose: () => undefined }), captureScreenshot: async () => undefined, uploadFileByLabel: async () => { order.push("upload"); }, accessibilityTree: async () => [{ role: "RootWebArea" }], versionAction: async () => undefined, assertVersionHistory: async () => undefined, assertLastBackupMetadata: async () => undefined,
    };
    await runInstalledRecoveryScenario({ view: view as never, evidencePath: "C:\\tmp\\scenario", phase: "stale-plan-rejection", snapshotTarget: async (name) => { order.push(`snapshot:${name}`); return JSON.stringify({ name, digest: "a".repeat(64), counts: { prompts: 1, versions: 2, tags: 2, relationships: 2 } }); }, mutateTarget: async () => { order.push("mutate"); } });
    expect(order).toEqual(["click:Settings", "snapshot:before", "upload", "wait:Previewed restore plan", "mutate", "click:Execute transactional restore", "live:Create a new preview", "snapshot:after"]);
  });
});
