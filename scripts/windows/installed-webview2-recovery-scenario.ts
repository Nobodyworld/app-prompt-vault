import { z } from "zod";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { win32 } from "node:path";
import { parseBackupText } from "../../src/domain/recovery.js";
import { assertDownloadPath, canonicalWindowsPath, PromptVaultWebView } from "./installed-webview2-cdp.js";

const semantic = z.object({ role: z.enum(["button", "link", "checkbox", "radio", "textbox", "combobox"]), name: z.string().min(1) }).strict();
const operation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), target: semantic }).strict(),
  z.object({ kind: z.literal("wait"), target: semantic }).strict(),
  z.object({ kind: z.literal("focus"), target: semantic }).strict(),
  z.object({ kind: z.literal("set-value"), label: z.string().min(1), value: z.string() }).strict(),
  z.object({ kind: z.literal("select"), label: z.string().min(1), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("check"), target: semantic, checked: z.boolean() }).strict(),
  z.object({ kind: z.literal("key"), key: z.enum(["Enter", "Space", "Escape", "Tab", "ArrowDown", "ArrowUp"]) }).strict(),
  z.object({ kind: z.literal("heading"), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("text"), value: z.string().min(1), exact: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("wait-text"), value: z.string().min(1), exact: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("live"), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("route"), pathname: z.string().regex(/^\//) }).strict(),
  z.object({ kind: z.literal("overflow") }).strict(),
  z.object({ kind: z.literal("download"), target: semantic, relativeDirectory: z.string().regex(/^[A-Za-z0-9._-]+(?:\\[A-Za-z0-9._-]+)*$/), expectedPrefix: z.string().regex(/^[A-Za-z0-9._-]+$/) }).strict(),
  z.object({ kind: z.literal("upload"), label: z.string().min(1), relativePath: z.string().regex(/^[A-Za-z0-9._-]+(?:\\[A-Za-z0-9._-]+)+$/) }).strict(),
  z.object({ kind: z.literal("screenshot"), relativePath: z.string().regex(/^[A-Za-z0-9._-]+\.png$/) }).strict(),
  z.object({ kind: z.literal("accessibility") }).strict(),
  z.object({ kind: z.literal("snapshot"), name: z.enum(["before", "after"]) }).strict(),
  z.object({ kind: z.literal("mutate-target"), mutation: z.literal("ordinary-product-write") }).strict(),
  z.object({ kind: z.literal("version-action"), semanticVersion: z.string().regex(/^\d+\.\d+\.\d+$/), action: z.enum(["preview", "compare", "close-preview", "revert"]) }).strict(),
  z.object({ kind: z.literal("version-history"), semanticVersions: z.array(z.string().regex(/^\d+\.\d+\.\d+$/)).min(1) }).strict(),
  z.object({ kind: z.literal("last-backup"), promptCount: z.number().int().nonnegative(), versionCount: z.number().int().nonnegative() }).strict(),
]);
type InstalledRecoveryOperation = z.infer<typeof operation>;

export const installedRecoveryPhaseSchema = z.enum([
  "self-test", "storage-status", "missing-legacy-source", "compatible-legacy-inspection", "explicit-legacy-restore", "backup-2-export-and-verify", "backup-1-preview-and-cancel", "skip-existing", "add-missing-versions", "import-as-copy", "cancellation", "stale-plan-rejection", "version-history-preview", "version-history-revert", "restart-verification", "version-history-restart-verification", "final-database-verification",
]);
export type InstalledRecoveryPhase = z.infer<typeof installedRecoveryPhaseSchema>;

export const installedRecoveryScenarioSchema = z.object({
  version: z.literal(1),
  name: z.literal("prompt-vault-installed-recovery"),
  phases: z.array(z.object({ phase: installedRecoveryPhaseSchema, operations: z.array(operation).min(1) }).strict()).length(17),
}).strict();
export type InstalledRecoveryScenario = z.infer<typeof installedRecoveryScenarioSchema>;
const settingsOperations: readonly InstalledRecoveryOperation[] = [
  { kind: "click" as const, target: { role: "link", name: "Settings" } },
  { kind: "heading" as const, value: "Settings" },
];

/**
 * Repository-owned constrained workflow. Fixture files and restore plans remain
 * production-generated; this document contains no JavaScript, selector, ID, or
 * fingerprint input and can therefore not become an arbitrary CDP evaluator.
 */
export const DEFAULT_INSTALLED_RECOVERY_SCENARIO: InstalledRecoveryScenario = {
  version: 1,
  name: "prompt-vault-installed-recovery",
  phases: [
    { phase: "self-test", operations: [{ kind: "click", target: { role: "link", name: "Settings" } }, { kind: "heading", value: "Settings" }, { kind: "overflow" }, { kind: "accessibility" }, { kind: "screenshot", relativePath: "phase-self-test.png" }] },
    { phase: "storage-status", operations: [...settingsOperations, { kind: "text", value: "Data safety and recovery" }, { kind: "text", value: "Runtime" }, { kind: "overflow" }] },
    { phase: "missing-legacy-source", operations: [...settingsOperations, { kind: "click", target: { role: "button", name: "Check historical database" } }, { kind: "live", value: "not found" }] },
    { phase: "compatible-legacy-inspection", operations: [...settingsOperations, { kind: "click", target: { role: "button", name: "Check historical database" } }, { kind: "live", value: "compatible" }, { kind: "text", value: "source SHA-256 recorded" }] },
    { phase: "explicit-legacy-restore", operations: [...settingsOperations, { kind: "click", target: { role: "button", name: "Check historical database" } }, { kind: "wait-text", value: "compatible" }, { kind: "click", target: { role: "button", name: "Preview historical recovery" } }, { kind: "wait-text", value: "Previewed restore plan" }, { kind: "text", value: "New prompt: 1" }, { kind: "check", target: { role: "checkbox", name: "Confirm 1 prompt records using skip existing" }, checked: true }, { kind: "click", target: { role: "button", name: "Execute transactional restore" } }, { kind: "live", value: "Restore verified" }, { kind: "text", value: "1 new · 0 copied · 0 versions merged · 0 prompts skipped · 0 versions skipped" }] },
    { phase: "backup-2-export-and-verify", operations: [...settingsOperations, { kind: "download", target: { role: "button", name: "Export verified backup 2.0" }, relativeDirectory: "downloads-first", expectedPrefix: "prompt-vault-backup-" }, { kind: "download", target: { role: "button", name: "Export verified backup 2.0" }, relativeDirectory: "downloads-second", expectedPrefix: "prompt-vault-backup-" }] },
    { phase: "backup-1-preview-and-cancel", operations: [...settingsOperations, { kind: "upload", label: "Choose backup JSON", relativePath: "fixtures\\backup1.json" }, { kind: "wait-text", value: "latest-version-only" }, { kind: "click", target: { role: "button", name: "Cancel preview" } }] },
    { phase: "skip-existing", operations: [...settingsOperations, { kind: "upload", label: "Choose backup JSON", relativePath: "fixtures\\skipExisting.json" }, { kind: "wait-text", value: "Previewed restore plan" }, { kind: "text", value: "Exact duplicate: 1" }, { kind: "text", value: "New prompt: 1" }, { kind: "select", label: "Conflict policy", value: "skip-existing" }, { kind: "check", target: { role: "checkbox", name: "Confirm 2 prompt records using skip existing" }, checked: true }, { kind: "click", target: { role: "button", name: "Execute transactional restore" } }, { kind: "live", value: "Restore verified" }, { kind: "text", value: "1 new · 0 copied · 0 versions merged · 1 prompts skipped · 2 versions skipped" }] },
    { phase: "add-missing-versions", operations: [...settingsOperations, { kind: "upload", label: "Choose backup JSON", relativePath: "fixtures\\addMissingVersions.json" }, { kind: "wait-text", value: "Previewed restore plan" }, { kind: "text", value: "Missing versions available: 1" }, { kind: "select", label: "Conflict policy", value: "add-missing-versions" }, { kind: "check", target: { role: "checkbox", name: "Confirm 1 prompt records using add missing versions" }, checked: true }, { kind: "click", target: { role: "button", name: "Execute transactional restore" } }, { kind: "live", value: "Restore verified" }, { kind: "text", value: "0 new · 0 copied · 1 versions merged · 0 prompts skipped · 1 versions skipped" }] },
    { phase: "import-as-copy", operations: [...settingsOperations, { kind: "upload", label: "Choose backup JSON", relativePath: "fixtures\\importAsCopy.json" }, { kind: "wait-text", value: "Previewed restore plan" }, { kind: "text", value: "Existing slug conflict: 1" }, { kind: "select", label: "Conflict policy", value: "import-as-copy" }, { kind: "check", target: { role: "checkbox", name: "Confirm 1 prompt records using import as copy" }, checked: true }, { kind: "click", target: { role: "button", name: "Execute transactional restore" } }, { kind: "live", value: "Restore verified" }, { kind: "text", value: "0 new · 1 copied · 0 versions merged · 0 prompts skipped · 0 versions skipped" }] },
    { phase: "cancellation", operations: [...settingsOperations, { kind: "upload", label: "Choose backup JSON", relativePath: "fixtures\\cancellation.json" }, { kind: "wait-text", value: "Previewed restore plan" }, { kind: "click", target: { role: "button", name: "Cancel preview" } }] },
    { phase: "stale-plan-rejection", operations: [...settingsOperations, { kind: "snapshot", name: "before" }, { kind: "upload", label: "Choose backup JSON", relativePath: "fixtures\\stalePlan.json" }, { kind: "wait-text", value: "Previewed restore plan" }, { kind: "mutate-target", mutation: "ordinary-product-write" }, { kind: "check", target: { role: "checkbox", name: "Confirm 1 prompt records using skip existing" }, checked: true }, { kind: "click", target: { role: "button", name: "Execute transactional restore" } }, { kind: "live", value: "Create a new preview" }, { kind: "snapshot", name: "after" }] },
    { phase: "version-history-preview", operations: [{ kind: "click", target: { role: "link", name: "Library" } }, { kind: "click", target: { role: "button", name: "Edit prompt Synthetic recovery" } }, { kind: "wait-text", value: "Version and organization" }, { kind: "version-action", semanticVersion: "1.0.0", action: "preview" }, { kind: "wait-text", value: "Preview v1.0.0" }, { kind: "version-action", semanticVersion: "1.0.0", action: "compare" }, { kind: "overflow" }] },
    { phase: "version-history-revert", operations: [{ kind: "click", target: { role: "link", name: "Library" } }, { kind: "click", target: { role: "button", name: "Edit prompt Synthetic recovery" } }, { kind: "wait-text", value: "Version and organization" }, { kind: "version-action", semanticVersion: "1.0.0", action: "revert" }, { kind: "wait-text", value: "Your prompt library" }, { kind: "overflow" }] },
    { phase: "restart-verification", operations: [...settingsOperations, { kind: "text", value: "Last verified backup" }, { kind: "last-backup", promptCount: 1, versionCount: 2 }] },
    { phase: "version-history-restart-verification", operations: [{ kind: "click", target: { role: "link", name: "Library" } }, { kind: "click", target: { role: "button", name: "Edit prompt Synthetic recovery" } }, { kind: "wait-text", value: "Version and organization" }, { kind: "version-history", semanticVersions: ["1.2.1", "1.2.0", "1.1.0", "1.0.0"] }, { kind: "version-action", semanticVersion: "1.2.1", action: "preview" }, { kind: "wait-text", value: "Revert to v1.0.0" }, { kind: "overflow" }] },
    { phase: "final-database-verification", operations: [...settingsOperations, { kind: "click", target: { role: "button", name: "Verify database integrity" } }, { kind: "live", value: "ok" }, { kind: "accessibility" }] },
  ],
};

export function parseInstalledRecoveryScenario(value: unknown): InstalledRecoveryScenario {
  return installedRecoveryScenarioSchema.parse(value);
}

export interface DownloadEvidence {
  readonly fileName: string;
  readonly size: number;
  readonly sha256: string;
  readonly format: string | null;
  readonly promptCount: number;
  readonly versionCount: number;
  readonly verified: boolean;
  readonly observedByCdp: boolean;
}

/**
 * A deliberately content-safe record of one completed scenario operation. The
 * acceptance runner persists this data verbatim, so it must never contain an
 * absolute local path, a prompt body, or an arbitrary value returned by the
 * application.
 */
export interface InstalledRecoveryOperationEvidence {
  readonly phase: InstalledRecoveryPhase;
  readonly operation: InstalledRecoveryOperation["kind"];
  readonly outcome: "passed";
  readonly details?: Readonly<Record<string, string | number | boolean | readonly string[]>>;
}

function snapshotEvidence(name: "before" | "after", serialized: string): InstalledRecoveryOperationEvidence["details"] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Canonical target snapshot provider did not return structured JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Canonical target snapshot provider did not return an object.");
  }
  const value = parsed as { readonly name?: unknown; readonly digest?: unknown; readonly counts?: unknown };
  if (value.name !== name || typeof value.digest !== "string" || !/^[a-f0-9]{64}$/i.test(value.digest) || !value.counts || typeof value.counts !== "object" || Array.isArray(value.counts)) {
    throw new Error("Canonical target snapshot provider returned an invalid safe summary.");
  }
  const counts = value.counts as Record<string, unknown>;
  const countNames = ["prompts", "versions", "tags", "relationships"] as const;
  const details: Record<string, string | number> = { snapshot: name, digest: value.digest.toLowerCase() };
  for (const countName of countNames) {
    const count = counts[countName];
    if (!Number.isSafeInteger(count) || (count as number) < 0) {
      throw new Error(`Canonical target snapshot ${name} has an invalid ${countName} count.`);
    }
    details[countName] = count as number;
  }
  return details;
}

export async function waitForVerifiedBackupDownload(downloadDirectory: string, expectedPrefix: string, observedNames: () => readonly string[] = () => [], timeoutMs = 15_000): Promise<DownloadEvidence> {
  const directory = canonicalWindowsPath(downloadDirectory, "download directory");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const entries = await readdir(directory);
      if (entries.some((entry) => /\.(?:crdownload|tmp|partial)$/i.test(entry))) throw new Error("download remains partial");
      const completed = entries.filter((entry) => entry.startsWith(expectedPrefix) && entry.endsWith(".json"));
      if (completed.length !== 1) { await new Promise((resolveWait) => setTimeout(resolveWait, 100)); continue; }
      const expectedFile = completed[0]!;
      const expected = win32.join(directory, expectedFile);
      const [content, info] = await Promise.all([readFile(expected, "utf8"), stat(expected)]);
      const validation = parseBackupText(content);
      if (!validation.valid || validation.version !== "2.0") throw new Error("Downloaded backup did not pass the production 2.0 verifier.");
      return { fileName: expectedFile, size: info.size, sha256: createHash("sha256").update(content).digest("hex"), format: validation.format, promptCount: validation.promptCount, versionCount: validation.versionCount, verified: true, observedByCdp: observedNames().includes(expectedFile) };
    } catch (error) { if (error instanceof Error && !/ENOENT|partial/.test(error.message)) throw error; await new Promise((resolveWait) => setTimeout(resolveWait, 100)); }
  }
  throw new Error(`Timed out waiting for one completed backup download matching ${expectedPrefix}.`);
}

export async function runInstalledRecoveryScenario(options: { readonly view: PromptVaultWebView; readonly evidencePath: string; readonly fixturePath?: string; readonly scenario?: unknown; readonly phase?: InstalledRecoveryPhase; readonly snapshotTarget?: (name: "before" | "after") => Promise<string>; readonly mutateTarget?: () => Promise<void>; readonly verifyBackup?: (content: string) => void }): Promise<readonly InstalledRecoveryOperationEvidence[]> {
  const scenario = parseInstalledRecoveryScenario(options.scenario ?? DEFAULT_INSTALLED_RECOVERY_SCENARIO);
  const evidence: InstalledRecoveryOperationEvidence[] = [];
  const phases = options.phase ? scenario.phases.filter((phase) => phase.phase === options.phase) : scenario.phases;
  const normalizedExports: string[] = [];
  const record = (phase: InstalledRecoveryPhase, operationKind: InstalledRecoveryOperation["kind"], details?: InstalledRecoveryOperationEvidence["details"]): void => {
    evidence.push(details ? { phase, operation: operationKind, outcome: "passed", details } : { phase, operation: operationKind, outcome: "passed" });
  };
  if (phases.length !== 1 && options.phase) throw new Error(`Unknown installed recovery phase: ${options.phase}.`);
  for (const phase of phases) for (const step of phase.operations) {
    switch (step.kind) {
      case "click": await options.view.clickByRole(step.target.role, step.target.name); record(phase.phase, step.kind, { role: step.target.role }); break;
      case "wait": await options.view.waitForByRole(step.target.role, step.target.name); record(phase.phase, step.kind, { role: step.target.role }); break;
      case "focus": await options.view.focusByRole(step.target.role, step.target.name); record(phase.phase, step.kind, { role: step.target.role }); break;
      case "set-value": await options.view.setInputValueByLabel(step.label, step.value); record(phase.phase, step.kind); break;
      case "select": await options.view.selectOptionByLabel(step.label, step.value); record(phase.phase, step.kind); break;
      case "check": await options.view.setCheckedByRole(step.target.role as "checkbox" | "radio", step.target.name, step.checked); record(phase.phase, step.kind, { role: step.target.role, checked: step.checked }); break;
      case "key": await options.view.dispatchKey(step.key); record(phase.phase, step.kind, { key: step.key }); break;
      case "heading": if (await options.view.headingText() !== step.value) throw new Error("Expected configured heading."); record(phase.phase, step.kind); break;
      case "text": await options.view.assertText(step.value, !step.exact); record(phase.phase, step.kind, { exact: step.exact ?? false }); break;
      case "wait-text": await options.view.waitForText(step.value, !step.exact); record(phase.phase, step.kind, { exact: step.exact ?? false }); break;
      case "live": await options.view.waitForLiveRegion(step.value); record(phase.phase, step.kind); break;
      case "route": await options.view.assertRoute(step.pathname); record(phase.phase, step.kind); break;
      case "overflow": await options.view.assertNoHorizontalOverflow(); record(phase.phase, step.kind); break;
      case "download": {
        const directory = assertDownloadPath(win32.join(options.evidencePath, step.relativeDirectory), options.evidencePath);
        await options.view.configureDownloadPath(directory, options.evidencePath);
        const observation = options.view.observeDownloadNames();
        try {
          await options.view.clickByRole(step.target.role, step.target.name);
          const download = await waitForVerifiedBackupDownload(directory, step.expectedPrefix, observation.names);
          const content = await readFile(assertDownloadPath(win32.join(directory, download.fileName), options.evidencePath), "utf8");
          options.verifyBackup?.(content);
          const document = JSON.parse(content) as { exportedAt?: unknown };
          document.exportedAt = "<normalized>";
          const normalizedSha256 = createHash("sha256").update(JSON.stringify(document)).digest("hex");
          normalizedExports.push(normalizedSha256);
          record(phase.phase, step.kind, { size: download.size, sha256: download.sha256, format: download.format ?? "unknown", promptCount: download.promptCount, versionCount: download.versionCount, verified: download.verified, observedByCdp: download.observedByCdp, normalizedSha256 });
        } finally {
          observation.dispose();
        }
        break;
      }
      case "upload": {
        const fixtureRoot = options.fixturePath ?? options.evidencePath;
        const path = assertDownloadPath(win32.join(fixtureRoot, step.relativePath), fixtureRoot);
        await options.view.uploadFileByLabel(step.label, path, fixtureRoot);
        record(phase.phase, step.kind);
        break;
      }
      case "screenshot": await options.view.captureScreenshot(win32.join(options.evidencePath, step.relativePath), options.evidencePath); record(phase.phase, step.kind); break;
      case "accessibility": {
        const nodes = await options.view.accessibilityTree();
        if (nodes.length === 0) throw new Error("Installed WebView accessibility tree was empty.");
        record(phase.phase, step.kind, { nodeCount: nodes.length });
        break;
      }
      case "snapshot": {
        if (!options.snapshotTarget) throw new Error("Scenario requires a canonical target snapshot provider.");
        record(phase.phase, step.kind, snapshotEvidence(step.name, await options.snapshotTarget(step.name)));
        break;
      }
      case "mutate-target": {
        if (!options.mutateTarget) throw new Error("Scenario requires the ordinary product mutation provider.");
        await options.mutateTarget();
        record(phase.phase, step.kind, { mutation: step.mutation });
        break;
      }
      case "version-action": await options.view.versionAction(step.semanticVersion, step.action); record(phase.phase, step.kind, { semanticVersion: step.semanticVersion, action: step.action }); break;
      case "version-history": await options.view.assertVersionHistory(step.semanticVersions); record(phase.phase, step.kind, { semanticVersions: step.semanticVersions }); break;
      case "last-backup": await options.view.assertLastBackupMetadata(step.promptCount, step.versionCount); record(phase.phase, step.kind, { promptCount: step.promptCount, versionCount: step.versionCount }); break;
    }
  }
  if (phases.some((phase) => phase.phase === "backup-2-export-and-verify")) {
    if (normalizedExports.length !== 2 || normalizedExports[0] !== normalizedExports[1]) throw new Error("Two unchanged backup exports differ after normalizing only exportedAt.");
    evidence.push({ phase: "backup-2-export-and-verify", operation: "download", outcome: "passed", details: { backupDeterminism: "verified", normalizedSha256: normalizedExports[0]! } });
  }
  return evidence;
}
