import { describe, expect, it } from "vitest";
import { classifyInstaller, executeSyntheticUpdate, sameInventory } from "../scripts/synthetic-update/executor.js";
import type { ExecutorPorts, InstallerResult } from "../scripts/synthetic-update/executor.js";
import type { ReadOnlyUpdateReport } from "../src/domain/localUpdateEvidence.js";

const files = [{ path: "acceptance.db", exists: true, bytes: 4096, sha256: "a".repeat(64) }, { path: "acceptance.db-wal", exists: false, bytes: 0, sha256: null }, { path: "acceptance.db-shm", exists: false, bytes: 0, sha256: null }];
function setup(changes: Partial<ExecutorPorts> = {}) {
  const calls: string[] = [];
  const plan = { planner: { decision: "upgrade" }, blockers: [], recovery: { ready: true }, installed: { reconciled: true }, payloadCorrespondenceProven: true } as unknown as ReadOnlyUpdateReport;
  const ports: ExecutorPorts = {
    inspect: async () => { calls.push("inspect"); return plan; }, recoveryProven: async () => { calls.push("recovery"); return true; },
    shutdown: async () => { calls.push("shutdown"); return "stopped"; }, inventory: async () => { calls.push("inventory"); return files; },
    install: async () => { calls.push("boundary-install"); return { launched: true, exitCode: 0, launchError: null }; },
    verifyCommitted: async () => { calls.push("verify-commit"); return true; }, verifyRollback: async () => { calls.push("verify-rollback"); return true; },
    restart: async () => { calls.push("restart"); return true; }, ...changes,
  };
  return { calls, plan, ports };
}
describe("synthetic executor", () => {
  it("orders quiescent inventory before install and before restart", async () => {
    const { ports, calls } = setup();
    expect(await executeSyntheticUpdate(ports)).toMatchObject({ status: "success", dataPreserved: true });
    expect(calls).toEqual(["inspect", "recovery", "shutdown", "inventory", "boundary-install", "inventory", "verify-commit", "restart"]);
  });
  it("does nothing for exact no-op even without recovery media", async () => {
    const { ports, calls, plan } = setup(); plan.planner.decision = "no-op";
    Object.assign(plan, { blockers: ["recovery:complete-original-media-required"] });
    expect(await executeSyntheticUpdate(ports)).toEqual({ status: "no-op", installerLaunched: false });
    expect(calls).toEqual(["inspect"]);
  });
  it.each(["refuse-downgrade", "refuse-same-version-different-payload", "refuse-foreign-target", "refuse-not-installed"])("refuses %s before shutdown", async (decision) => {
    const { ports, plan, calls } = setup(); plan.planner.decision = decision;
    expect(await executeSyntheticUpdate(ports)).toMatchObject({ status: "refused", installerLaunched: false }); expect(calls).toEqual(["inspect"]);
  });
  it.each(["selected:artifact-digest-mismatch", "selected:executable-payload-unproven", "selected:valid-source-manifest-required", "installed:unverified-process", "recovery:complete-original-media-required", "recovery:cached-msi-is-insufficient"])("blocks %s without launch", async (blocker) => {
    const { ports, plan, calls } = setup(); Object.assign(plan, { blockers: [blocker] });
    expect(await executeSyntheticUpdate(ports)).toMatchObject({ status: "refused" }); expect(calls).toEqual(["inspect"]);
  });
  it("requires actual recovery proof in addition to the planner receipt", async () => {
    const { ports, calls } = setup({ recoveryProven: async () => false });
    expect(await executeSyntheticUpdate(ports)).toMatchObject({ status: "refused" }); expect(calls).toEqual(["inspect"]);
  });
  it.each(["timeout", "refused", "cancelled"] as const)("stops after graceful shutdown %s", async (status) => {
    const { ports, calls } = setup({ shutdown: async () => status });
    expect(await executeSyntheticUpdate(ports)).toMatchObject({ status: `shutdown-${status}`, installerLaunched: false }); expect(calls).not.toContain("boundary-install");
  });
  it("fails closed if boundary revalidation throws", async () => {
    const { ports, calls } = setup({ install: async () => { throw new Error("changed package"); } });
    await expect(executeSyntheticUpdate(ports)).rejects.toThrow("changed package"); expect(calls).not.toContain("restart");
  });
  it.each([
    [{ launched: false, exitCode: null, launchError: 1223 }, "elevation-cancelled"],
    [{ launched: false, exitCode: null, launchError: 1312 }, "launch-failed"],
    [{ launched: true, exitCode: 1602, launchError: null }, "installer-cancelled"],
    [{ launched: true, exitCode: null, launchError: null }, "installer-outcome-unknown"],
    [{ launched: true, exitCode: 1641, launchError: null }, "committed-reboot-initiated"],
  ] as const)("classifies installer boundary %j and never retries", async (installer, status) => {
    let launches = 0;
    const { ports, calls } = setup({ install: async () => { launches++; return installer; } });
    expect(classifyInstaller(installer)).toBe(status);
    expect(await executeSyntheticUpdate(ports)).toMatchObject({ status, transactionRollbackProven: false });
    expect(launches).toBe(1); expect(calls).not.toContain("restart"); expect(calls).not.toContain("verify-rollback");
  });
  it.each([true, false])("requires observed rollback identity plus quiescent data: %s", async (proven) => {
    const { ports, calls } = setup({ install: async () => ({ launched: true, exitCode: 1603, launchError: null }), verifyRollback: async () => proven });
    expect(await executeSyntheticUpdate(ports)).toMatchObject({ status: "transaction-failed", transactionRollbackProven: proven }); expect(calls).not.toContain("restart");
  });
  it.each(["verification", "data", "restart"])("classifies post-commit %s failure as recovery-required", async (failure) => {
    let inventories = 0;
    const { ports } = setup({ verifyCommitted: async () => failure !== "verification", inventory: async () => ++inventories === 2 && failure === "data" ? files.slice(1) : files, restart: async () => failure !== "restart" });
    expect(await executeSyntheticUpdate(ports)).toMatchObject({ status: failure === "restart" ? "committed-restart-failed" : "committed-verification-failed", outcome: { installerCommitted: true, transactionRollbackProven: false, followUp: "recovery-required" } });
  });
  it("records reboot required and does not restart", async () => {
    const { ports, calls } = setup({ install: async (): Promise<InstallerResult> => ({ launched: true, exitCode: 3010, launchError: null }) });
    expect(await executeSyntheticUpdate(ports)).toMatchObject({ status: "success-reboot-required", restartAttempted: false }); expect(calls).not.toContain("restart");
  });
  it("compares presence, sizes and hashes including WAL/SHM without deleting them", () => {
    expect(sameInventory(files, [...files].reverse())).toBe(true);
    expect(sameInventory(files, files.slice(0, 1))).toBe(false);
    expect(sameInventory(files, [files[0], files[0]])).toBe(false);
    expect(sameInventory(files, files.map((file) => ({ ...file, bytes: 1 })))).toBe(false);
    expect(sameInventory(files, files.map((file) => ({ ...file, sha256: "b".repeat(64) })))).toBe(false);
  });
});
