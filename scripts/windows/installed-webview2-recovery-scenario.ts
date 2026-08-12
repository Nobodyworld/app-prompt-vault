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
  z.object({ kind: z.literal("version-action"), semanticVersion: z.string().regex(/^\d+\.\d+\.\d+$/), action: z.enum(["preview", "compare", "close-preview", "revert"]) }).strict(),
]);
type InstalledRecoveryOperation = z.infer<typeof operation>;

export const installedRecoveryPhaseSchema = z.enum([
  "self-test", "storage-status", "missing-legacy-source", "compatible-legacy-inspection", "explicit-legacy-restore", "backup-2-export-and-verify", "backup-1-preview-and-cancel", "skip-existing", "add-missing-versions", "import-as-copy", "cancellation", "stale-plan-rejection", "version-history-preview", "version-history-revert", "restart-verification", "final-database-verification",
]);
export type InstalledRecoveryPhase = z.infer<typeof installedRecoveryPhaseSchema>;

export const installedRecoveryScenarioSchema = z.object({
  version: z.literal(1),
  name: z.literal("prompt-vault-installed-recovery"),
  phases: z.array(z.object({ phase: installedRecoveryPhaseSchema, operations: z.array(operation).min(1) }).strict()).length(16),
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
    { phase: "explicit-legacy-restore", operations: [...settingsOperations, { kind: "click", target: { role: "button", name: "Check historical database" } }, { kind: "wait-text", value: "compatible" }, { kind: "click", target: { role: "button", name: "Preview historical recovery" } }, { kind: "wait-text", value: "Previewed restore plan" }, { kind: "check", target: { role: "checkbox", name: "Confirm 1 prompt records using skip existing" }, checked: true }, { kind: "click", target: { role: "button", name: "Execute transactional restore" } }, { kind: "live", value: "Restore verified" }] },
    { phase: "backup-2-export-and-verify", operations: [...settingsOperations, { kind: "download", target: { role: "button", name: "Export verified backup 2.0" }, relativeDirectory: "downloads", expectedPrefix: "prompt-vault-backup-" }] },
    { phase: "backup-1-preview-and-cancel", operations: [...settingsOperations, { kind: "upload", label: "Choose backup JSON", relativePath: "fixtures\\backup1.json" }, { kind: "wait-text", value: "latest-version-only" }, { kind: "click", target: { role: "button", name: "Cancel preview" } }] },
    { phase: "skip-existing", operations: [...settingsOperations, { kind: "upload", label: "Choose backup JSON", relativePath: "fixtures\\skipExisting.json" }, { kind: "wait-text", value: "Previewed restore plan" }, { kind: "select", label: "Conflict policy", value: "skip-existing" }, { kind: "check", target: { role: "checkbox", name: "Confirm 2 prompt records using skip existing" }, checked: true }, { kind: "click", target: { role: "button", name: "Execute transactional restore" } }, { kind: "live", value: "Restore verified" }] },
    { phase: "add-missing-versions", operations: [...settingsOperations, { kind: "upload", label: "Choose backup JSON", relativePath: "fixtures\\addMissingVersions.json" }, { kind: "wait-text", value: "Previewed restore plan" }, { kind: "select", label: "Conflict policy", value: "add-missing-versions" }, { kind: "check", target: { role: "checkbox", name: "Confirm 1 prompt records using add missing versions" }, checked: true }, { kind: "click", target: { role: "button", name: "Execute transactional restore" } }, { kind: "live", value: "Restore verified" }] },
    { phase: "import-as-copy", operations: [...settingsOperations, { kind: "upload", label: "Choose backup JSON", relativePath: "fixtures\\importAsCopy.json" }, { kind: "wait-text", value: "Previewed restore plan" }, { kind: "select", label: "Conflict policy", value: "import-as-copy" }, { kind: "check", target: { role: "checkbox", name: "Confirm 1 prompt records using import as copy" }, checked: true }, { kind: "click", target: { role: "button", name: "Execute transactional restore" } }, { kind: "live", value: "Restore verified" }] },
    { phase: "cancellation", operations: [...settingsOperations, { kind: "upload", label: "Choose backup JSON", relativePath: "fixtures\\cancellation.json" }, { kind: "wait-text", value: "Previewed restore plan" }, { kind: "click", target: { role: "button", name: "Cancel preview" } }] },
    { phase: "stale-plan-rejection", operations: [...settingsOperations, { kind: "upload", label: "Choose backup JSON", relativePath: "fixtures\\stalePlan.json" }, { kind: "wait-text", value: "Previewed restore plan" }, { kind: "live", value: "Create a new preview" }] },
    { phase: "version-history-preview", operations: [{ kind: "click", target: { role: "link", name: "Library" } }, { kind: "click", target: { role: "button", name: "Edit prompt Synthetic recovery" } }, { kind: "wait-text", value: "Version and organization" }, { kind: "version-action", semanticVersion: "1.0.0", action: "preview" }, { kind: "wait-text", value: "Preview v1.0.0" }, { kind: "version-action", semanticVersion: "1.0.0", action: "compare" }, { kind: "overflow" }] },
    { phase: "version-history-revert", operations: [{ kind: "click", target: { role: "link", name: "Library" } }, { kind: "click", target: { role: "button", name: "Edit prompt Synthetic recovery" } }, { kind: "wait-text", value: "Version and organization" }, { kind: "version-action", semanticVersion: "1.0.0", action: "revert" }, { kind: "wait-text", value: "Revert to v1.0.0" }, { kind: "overflow" }] },
    { phase: "restart-verification", operations: [...settingsOperations, { kind: "text", value: "Last verified backup" }] },
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

export async function runInstalledRecoveryScenario(options: { readonly view: PromptVaultWebView; readonly evidencePath: string; readonly scenario?: unknown; readonly phase?: InstalledRecoveryPhase }): Promise<readonly string[]> {
  const scenario = parseInstalledRecoveryScenario(options.scenario ?? DEFAULT_INSTALLED_RECOVERY_SCENARIO);
  const evidence: string[] = [];
  const phases = options.phase ? scenario.phases.filter((phase) => phase.phase === options.phase) : scenario.phases;
  if (phases.length !== 1 && options.phase) throw new Error(`Unknown installed recovery phase: ${options.phase}.`);
  for (const phase of phases) for (const step of phase.operations) {
    switch (step.kind) {
      case "click": await options.view.clickByRole(step.target.role, step.target.name); break;
      case "wait": await options.view.waitForByRole(step.target.role, step.target.name); break;
      case "focus": await options.view.focusByRole(step.target.role, step.target.name); break;
      case "set-value": await options.view.setInputValueByLabel(step.label, step.value); break;
      case "select": await options.view.selectOptionByLabel(step.label, step.value); break;
      case "check": await options.view.setCheckedByRole(step.target.role as "checkbox" | "radio", step.target.name, step.checked); break;
      case "key": await options.view.dispatchKey(step.key); break;
      case "heading": if (await options.view.headingText() !== step.value) throw new Error(`Expected heading ${step.value}.`); break;
      case "text": await options.view.assertText(step.value, !step.exact); break;
      case "wait-text": await options.view.waitForText(step.value, !step.exact); break;
      case "live": await options.view.assertLiveRegion(step.value); break;
      case "route": await options.view.assertRoute(step.pathname); break;
      case "overflow": await options.view.assertNoHorizontalOverflow(); break;
      case "download": { const directory = assertDownloadPath(win32.join(options.evidencePath, step.relativeDirectory), options.evidencePath); await options.view.configureDownloadPath(directory, options.evidencePath); const observation = options.view.observeDownloadNames(); try { await options.view.clickByRole(step.target.role, step.target.name); const download = await waitForVerifiedBackupDownload(directory, step.expectedPrefix, observation.names); evidence.push(JSON.stringify({ phase: phase.phase, download })); } finally { observation.dispose(); } break; }
      case "upload": { const path = assertDownloadPath(win32.join(options.evidencePath, step.relativePath), options.evidencePath); await options.view.uploadFileByLabel(step.label, path, options.evidencePath); break; }
      case "screenshot": await options.view.captureScreenshot(win32.join(options.evidencePath, step.relativePath), options.evidencePath); evidence.push(step.relativePath); break;
      case "accessibility": if ((await options.view.accessibilityTree()).length === 0) throw new Error("Installed WebView accessibility tree was empty."); break;
      case "version-action": await options.view.versionAction(step.semanticVersion, step.action); break;
    }
  }
  return evidence;
}
