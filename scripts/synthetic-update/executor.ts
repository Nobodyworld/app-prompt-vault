import { classifyLocalUpdateOutcome } from "../../src/domain/localUpdate.js";
import type { ReadOnlyUpdateReport } from "../../src/domain/localUpdateEvidence.js";

export interface InstallerResult {
  launched: boolean;
  exitCode: number | null;
  launchError: number | null;
}
export interface DataFile { path: string; exists: boolean; bytes: number; sha256: string | null }
export function sameInventory(before: readonly DataFile[], after: readonly DataFile[]): boolean {
  const canonical = (files: readonly DataFile[]) => [...files].sort((a, b) => a.path.localeCompare(b.path)).map(({ path, exists, bytes, sha256 }) => ({ path, exists, bytes, sha256 }));
  return new Set(before.map((file) => file.path)).size === before.length
    && new Set(after.map((file) => file.path)).size === after.length
    && JSON.stringify(canonical(before)) === JSON.stringify(canonical(after));
}
export function classifyInstaller(result: InstallerResult) {
  if (!result.launched) return result.launchError === 1223 ? "elevation-cancelled" : "launch-failed";
  if (result.exitCode === null) return "installer-outcome-unknown";
  if (result.exitCode === 1602) return "installer-cancelled";
  if (result.exitCode === 1641) return "committed-reboot-initiated";
  if (result.exitCode === 0 || result.exitCode === 3010) return "committed";
  return "transaction-failed";
}
export interface ExecutorPorts {
  inspect(): Promise<ReadOnlyUpdateReport>;
  recoveryProven(): Promise<boolean>;
  shutdown(): Promise<"stopped" | "timeout" | "refused" | "cancelled">;
  inventory(): Promise<DataFile[]>;
  // Rechecks source/manifest/package/payload, target and recovery, then holds
  // read locks across human consent and MSI execution. No cached plan authority.
  install(): Promise<InstallerResult>;
  verifyCommitted(): Promise<boolean>;
  verifyRollback(): Promise<boolean>;
  restart(): Promise<boolean>;
}

/** Acceptance-only sequencing. No product command calls this executor. */
export async function executeSyntheticUpdate(ports: ExecutorPorts) {
  const plan = await ports.inspect();
  const selectedBlocked = plan.blockers.some((blocker) => !blocker.startsWith("recovery:"));
  if (plan.planner.decision === "no-op" && !selectedBlocked && plan.installed.reconciled && plan.payloadCorrespondenceProven) return { status: "no-op", installerLaunched: false };
  if (plan.planner.decision !== "upgrade" || plan.blockers.length || !plan.recovery.ready || !await ports.recoveryProven()) return { status: "refused", installerLaunched: false, blockers: plan.blockers };
  const shutdown = await ports.shutdown();
  if (shutdown !== "stopped") return { status: `shutdown-${shutdown}`, installerLaunched: false };
  const before = await ports.inventory();
  // An exception before launch remains a refusal; the native helper always
  // persists launch/outcome evidence once it crosses the installer boundary.
  const installer = await ports.install();
  let after: DataFile[] = [];
  let postInstallInventoryAvailable = true;
  try { after = await ports.inventory(); } catch { postInstallInventoryAvailable = false; }
  const dataPreserved = postInstallInventoryAvailable && sameInventory(before, after);
  const classification = classifyInstaller(installer);
  if (classification !== "committed") {
    let rollbackProven = false;
    if (classification === "transaction-failed" && dataPreserved) { try { rollbackProven = await ports.verifyRollback(); } catch { /* Unavailable proof is not rollback. */ } }
    return { status: classification, installerLaunched: installer.launched, installer, dataPreserved, before, after, postInstallInventoryAvailable, transactionRollbackProven: rollbackProven, followUp: dataPreserved && (classification === "elevation-cancelled" || classification === "launch-failed" || rollbackProven) ? "none" : "inspect-installation-before-any-further-operation" };
  }
  let identityVerified = false;
  try { identityVerified = await ports.verifyCommitted(); } catch { /* A committed installer still requires recovery when inspection fails. */ }
  const verified = identityVerified && dataPreserved;
  // Reboot-required is terminal for this attended run. No automatic reboot.
  const restartAttempted = verified && installer.exitCode === 0;
  let restartPassed: boolean | undefined;
  if (restartAttempted) { try { restartPassed = await ports.restart(); } catch { restartPassed = false; } }
  return { status: classifyLocalUpdateOutcome({ installerLaunched: true, installerExitCode: installer.exitCode, postInstallVerificationPassed: verified, restartAttempted, restartPassed }).kind,
    outcome: classifyLocalUpdateOutcome({ installerLaunched: true, installerExitCode: installer.exitCode, postInstallVerificationPassed: verified, restartAttempted, restartPassed }),
    installerLaunched: true, installer, before, after, postInstallInventoryAvailable, dataPreserved, identityVerified, restartAttempted, restartPassed };
}
