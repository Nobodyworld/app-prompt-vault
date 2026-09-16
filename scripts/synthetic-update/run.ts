import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { plainFile } from "../plan-local-update.js";
import { planObservedLocalUpdate, SYNTHETIC_UPDATE_TARGET } from "../../src/domain/localUpdateEvidence.js";
import type { ReadOnlyUpdateReport, UpdateObservation } from "../../src/domain/localUpdateEvidence.js";
import { SYNTHETIC_UPDATE_IDENTIFIER, validateLocalUpdateManifest } from "../../src/domain/localUpdate.js";
import type { LocalUpdateManifest } from "../../src/domain/localUpdate.js";
import { classifyInstaller, executeSyntheticUpdate, sameInventory } from "./executor.js";
import type { DataFile, InstallerResult } from "./executor.js";

const scripts = resolve(dirname(fileURLToPath(import.meta.url)), "..", "windows");
const hash = (path: string) => createHash("sha256").update(readFileSync(plainFile(path))).digest("hex");
function powershell<T>(script: string, input: unknown, args: string[] = []): T {
  return JSON.parse(execFileSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-File", join(scripts, script), ...args], { input: JSON.stringify(input), encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 }).replace(/^\uFEFF/, "")) as T;
}
export function readSyntheticManifest(path: string) {
  path = plainFile(path);
  const value = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as Record<string, unknown>;
  const manifest = validateLocalUpdateManifest(value, SYNTHETIC_UPDATE_IDENTIFIER).manifest;
  assert.ok(manifest, "Invalid synthetic manifest");
  assert.equal(manifest.msi.upgradeCode, "{975929E8-18E6-44F5-BA40-157F667F18CD}");
  assert.equal(manifest.msi.installScope, "per-machine");
  assert.equal(manifest.artifact.relativePath, "acceptance.msi");
  assert.equal(manifest.executable.relativePath, SYNTHETIC_UPDATE_TARGET.executable);
  const msiPath = plainFile(join(dirname(path), manifest.artifact.relativePath));
  assert.equal(hash(msiPath), manifest.artifact.sha256);
  return { value, manifest, path, msiPath, manifestSha256: hash(path) };
}
function observe(selected: ReturnType<typeof readSyntheticManifest>, prior?: ReturnType<typeof readSyntheticManifest>) {
  const procedure = prior?.value.recoveryProcedure as { relativePath: string } | undefined;
  return powershell<UpdateObservation>("collect-update-evidence.ps1", { selectedPath: selected.msiPath, recoveryPath: prior?.msiPath ?? null, procedurePath: procedure ? plainFile(join(dirname(prior!.path), procedure.relativePath)) : null }, ["-SyntheticAcceptance"]);
}
function identityMatches(observation: UpdateObservation, manifest: LocalUpdateManifest): boolean {
  const report = planObservedLocalUpdate(undefined, observation, undefined, SYNTHETIC_UPDATE_TARGET);
  const installed = report.installed.identity;
  return report.installed.reconciled && !!installed && installed.applicationIdentifier === manifest.application.identifier
    && installed.productCode === manifest.msi.productCode && installed.packageCode === manifest.msi.packageCode
    && installed.upgradeCode === manifest.msi.upgradeCode && installed.installScope === manifest.msi.installScope
    && installed.version === manifest.application.version && installed.executableSha256 === manifest.executable.sha256;
}

// One explicit action per invocation. No retry, chained recovery, automatic UAC
// approval or ordinary product command. Paths/context are private local evidence.
export async function main(args: string[]) {
  assert.equal(process.platform, "win32");
  const [action, requestFile] = args;
  assert.equal(args.length, 2);
  assert.ok(["inspect", "install-old", "upgrade", "cancel", "rollback", "verification-failure", "restart-failure", "uninstall", "recovery-install", "restart", "shutdown", "inventory"].includes(action));
  const input = JSON.parse(readFileSync(plainFile(requestFile), "utf8").replace(/^\uFEFF/, "")) as {
    manifestPath: string; recoveryManifestPath?: string; recoveryProofPath?: string; resultPath: string; ownerSid: string; argument?: string;
  };
  const selected = readSyntheticManifest(input.manifestPath);
  const prior = input.recoveryManifestPath ? readSyntheticManifest(input.recoveryManifestPath) : undefined;
  assert.ok(!existsSync(input.resultPath), "Existing evidence is protected; use a separately authorized new attempt");
  const boundary = <T>(boundaryAction: string, fields: Record<string, unknown> = {}) => powershell<T>("synthetic-update-boundary.ps1", {
    action: boundaryAction, ownerSid: input.ownerSid, manifestPath: selected.path, manifestSha256: selected.manifestSha256, ...fields,
  });
  const beforeObservation = observe(selected, prior);
  const report = () => planObservedLocalUpdate(selected.value, observe(selected, prior), prior?.value, SYNTHETIC_UPDATE_TARGET);
  const initialReport = planObservedLocalUpdate(selected.value, beforeObservation, prior?.value, SYNTHETIC_UPDATE_TARGET);
  const inventory = () => boundary<DataFile[]>("inventory");
  const selectedValid = () => assert.ok(initialReport.selectedManifest.artifactVerified && initialReport.payloadCorrespondenceProven && !initialReport.blockers.some((x) => x.startsWith("selected:") || x.startsWith("evidence:")), "Selected package/payload validation failed");
  const shutdown = (manifest = selected) => powershell<{ status: "stopped" | "timeout" | "refused" | "cancelled" }>("synthetic-update-boundary.ps1", { action: "shutdown", ownerSid: input.ownerSid, manifestPath: manifest.path, manifestSha256: manifest.manifestSha256 }).status;
  let result: unknown;
  if (action === "inspect") result = initialReport;
  else if (action === "inventory") result = inventory();
  else if (action === "shutdown") result = { status: shutdown() };
  else if (action === "restart") {
    selectedValid(); assert.ok(identityMatches(beforeObservation, selected.manifest));
    result = boundary("restart", { argument: input.argument ?? "--run" });
  } else {
    selectedValid();
    const installerEvidence = input.resultPath + ".installer.json";
    const logPath = input.resultPath + ".msi.log";
    const launch = (remove: boolean, installedManifest?: LocalUpdateManifest) => {
      assert.equal(hash(selected.path), selected.manifestSha256, "Manifest changed since planning");
      const current = observe(selected, prior);
      if (installedManifest) assert.ok(identityMatches(current, installedManifest), "Installed identity changed since planning");
      else assert.equal(current.registrations.length, 0);
      const procedure = prior?.value.recoveryProcedure as { relativePath: string } | undefined;
      return boundary<InstallerResult>(remove ? "uninstall" : "install", {
        expectedProductCode: installedManifest?.msi.productCode ?? null,
        expectedPackageCode: installedManifest?.msi.packageCode ?? null,
        installedExecutableSha256: installedManifest?.executable.sha256 ?? null,
        recoveryManifestPath: prior?.path ?? null, recoveryManifestSha256: prior?.manifestSha256 ?? null,
        procedurePath: procedure ? join(dirname(prior!.path), procedure.relativePath) : null,
        injectTransactionFailure: action === "rollback", resultPath: installerEvidence, logPath,
      });
    };
    if (action === "install-old" || action === "recovery-install") {
      assert.equal(selected.manifest.application.version, "1.0.0", "Only the synthetic baseline can bootstrap");
      assert.equal(beforeObservation.registrations.length, 0);
      assert.equal(beforeObservation.processes.length, 0);
      assert.equal(beforeObservation.errors.length, 0);
      const before = inventory();
      if (action === "install-old") assert.ok(before.every((file) => !file.exists), "Synthetic baseline requires absent data");
      const installer = launch(false);
      const after = inventory();
      const afterObservation = observe(selected);
      result = { status: classifyInstaller(installer), installer, dataPreserved: sameInventory(before, after), before, after, identityVerified: identityMatches(afterObservation, selected.manifest), afterObservation };
    } else if (action === "uninstall") {
      assert.ok(identityMatches(beforeObservation, selected.manifest));
      assert.equal(shutdown(), "stopped");
      const before = inventory(); const installer = launch(true, selected.manifest); const after = inventory();
      const afterObservation = observe(selected);
      result = { status: classifyInstaller(installer), installer, dataPreserved: sameInventory(before, after), before, after, uninstalled: afterObservation.registrations.length === 0 && afterObservation.relatedProducts.length === 0 && afterObservation.processes.length === 0 && afterObservation.errors.length === 0, afterObservation };
    } else {
      assert.ok(prior, "Prior original media required");
      // The receipt points to two actual completed attended operations and binds
      // their hashes. A procedure document alone is never acceptance proof.
      const recoveryProven = () => {
        if (!input.recoveryProofPath) return false;
        try {
          const proof = JSON.parse(readFileSync(plainFile(input.recoveryProofPath), "utf8"));
          assert.equal(proof.priorPackageSha256, prior.manifest.artifact.sha256);
          assert.equal(proof.sourceCommit, prior.manifest.application.sourceCommit);
          for (const stage of ["uninstall", "reinstall"] as const) {
            const receipt = proof[stage]; assert.equal(hash(receipt.path), receipt.sha256);
            const actual = JSON.parse(readFileSync(plainFile(receipt.path), "utf8"));
            assert.equal(actual.status, "committed"); assert.equal(actual.installer.exitCode, 0); assert.equal(actual.dataPreserved, true);
            assert.equal(actual.installer.package.artifact.sha256, prior.manifest.artifact.sha256);
            assert.equal(actual.installer.package.msi.productCode, prior.manifest.msi.productCode);
            assert.equal(actual.installer.package.msi.packageCode, prior.manifest.msi.packageCode);
            assert.equal(stage === "uninstall" ? actual.uninstalled : actual.identityVerified, true);
          }
          return true;
        } catch { return false; }
      };
      result = await executeSyntheticUpdate({
        inspect: async () => report(), recoveryProven: async () => recoveryProven(), shutdown: async () => shutdown(prior), inventory: async () => inventory(),
        install: async () => {
          const fresh = report(); assert.equal(fresh.planner.decision, "upgrade"); assert.equal(fresh.blockers.length, 0); assert.ok(recoveryProven());
          return launch(false, prior.manifest);
        },
        verifyCommitted: async () => {
          const observed = observe(selected);
          // Explicit verifier fault, after an actual successful commit; no
          // executable is damaged and no MSI rollback is inferred.
          const expected = action === "verification-failure" ? { ...selected.manifest, executable: { ...selected.manifest.executable, sha256: "0".repeat(64) } } : selected.manifest;
          writeFileSync(input.resultPath + ".post-install.json", JSON.stringify({ observed, actualIdentityMatches: identityMatches(observed, selected.manifest), injectedExpectedHashMismatch: action === "verification-failure" }, null, 2), { flag: "wx" });
          return identityMatches(observed, expected);
        },
        verifyRollback: async () => {
          const observed = observe(prior);
          const logBytes = existsSync(logPath) ? readFileSync(logPath) : Buffer.alloc(0);
          const log = logBytes.toString(logBytes[0] === 0xff && logBytes[1] === 0xfe ? "utf16le" : "utf8");
          const rollback = /Rollback/i.test(log) && /WixFailWhenDeferred/i.test(log) && /Return value 3/i.test(log);
          writeFileSync(input.resultPath + ".rollback.json", JSON.stringify({ logShowsInjectedFailureAndRollback: rollback, restoredIdentity: identityMatches(observed, prior.manifest), observed }, null, 2), { flag: "wx" });
          return rollback && identityMatches(observed, prior.manifest);
        },
        restart: async () => boundary<{ passed: boolean }>("restart", { argument: action === "restart-failure" ? "--restart-failure" : "--run" }).passed,
      });
    }
  }
  writeFileSync(input.resultPath, JSON.stringify(result, null, 2), { flag: "wx" });
  // Full paths, registration and process evidence stay in the private report.
  const outcome = result as { status?: string; identityVerified?: boolean; dataPreserved?: boolean; transactionRollbackProven?: boolean };
  console.log(JSON.stringify({ action, status: outcome.status ?? "recorded", identityVerified: outcome.identityVerified, dataPreserved: outcome.dataPreserved, transactionRollbackProven: outcome.transactionRollbackProven }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(() => { console.error("Synthetic acceptance refused or blocked; inspect private attempt evidence before any further action."); process.exitCode = 2; });
