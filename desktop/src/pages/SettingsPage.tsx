import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTheme } from "../components/ThemeProvider";
import { useToast } from "../components/Toast";
import { isTauriAvailable } from "../lib/tauri";
import {
  executeBackupRestore,
  executeLegacyRestore,
  exportVerifiedBackup,
  getStorageStatus,
  inspectLegacySource,
  previewBackupRestore,
  previewLegacyRestore,
} from "../services/promptApi";
import type {
  BackupValidationResult,
  LegacyRecoveryPreview,
  LegacySourceStatus,
  RestorePlan,
  RestorePolicy,
  RestoreResult,
  StorageStatus,
} from "../../../src/domain/recovery";

type WindowPlacement = "left" | "right";
type RecoverySource = "backup" | "legacy";

const LAST_BACKUP_KEY = "prompt-vault:last-backup:v1";

interface LastBackupMetadata {
  readonly timestamp: string;
  readonly backupFormat: "2.0";
  readonly promptCount: number;
  readonly versionCount: number;
  readonly verificationResult: "verified";
}

function readLastBackup(): LastBackupMetadata | null {
  try {
    const raw = localStorage.getItem(LAST_BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastBackupMetadata>;
    return parsed.backupFormat === "2.0" && parsed.verificationResult === "verified"
      ? (parsed as LastBackupMetadata)
      : null;
  } catch {
    return null;
  }
}

function formatBytes(value: number | null): string {
  if (value === null) return "Unavailable";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function conflictLabel(kind: RestorePlan["entries"][number]["kind"]): string {
  return {
    "new-prompt": "New prompt",
    "existing-exact-duplicate": "Exact duplicate",
    "existing-slug-conflict": "Existing slug conflict",
    "mergeable-missing-versions": "Missing versions available",
    "copy-required-conflict": "Same version label with different content",
  }[kind];
}

export function SettingsPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const [placement, setPlacement] = useState<WindowPlacement>("left");
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [isCheckingIntegrity, setIsCheckingIntegrity] = useState(false);
  const [lastBackup, setLastBackup] = useState<LastBackupMetadata | null>(() =>
    readLastBackup(),
  );
  const [isExporting, setIsExporting] = useState(false);
  const [sourceKind, setSourceKind] = useState<RecoverySource | null>(null);
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [sourceContent, setSourceContent] = useState<string | null>(null);
  const [validation, setValidation] = useState<BackupValidationResult | null>(null);
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [policy, setPolicy] = useState<RestorePolicy>("skip-existing");
  const [confirmed, setConfirmed] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [legacyStatus, setLegacyStatus] = useState<LegacySourceStatus | null>(null);
  const [legacyPreview, setLegacyPreview] = useState<LegacyRecoveryPreview | null>(null);
  const [isCheckingLegacy, setIsCheckingLegacy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStorageStatus = useCallback(async (integrity = false): Promise<void> => {
    if (integrity) setIsCheckingIntegrity(true);
    setStorageError(null);
    try {
      setStorage(await getStorageStatus(integrity));
    } catch (caught: unknown) {
      setStorageError(
        caught instanceof Error ? caught.message : "Storage status is unavailable.",
      );
    } finally {
      if (integrity) setIsCheckingIntegrity(false);
    }
  }, []);

  useEffect(() => {
    void loadStorageStatus();
  }, [loadStorageStatus]);

  const positionWindow = useCallback(
    async (nextPlacement: WindowPlacement): Promise<void> => {
      if (!isTauriAvailable()) return;
      try {
        const { currentMonitor, getCurrentWindow, LogicalPosition } =
          await import("@tauri-apps/api/window");
        const monitor = await currentMonitor();
        if (!monitor) return;
        const currentWindow = getCurrentWindow();
        const scaleFactor = monitor.scaleFactor;
        const workAreaPosition = monitor.workArea.position.toLogical(scaleFactor);
        const workAreaSize = monitor.workArea.size.toLogical(scaleFactor);
        const windowSize = (await currentWindow.outerSize()).toLogical(scaleFactor);
        const x =
          nextPlacement === "left"
            ? workAreaPosition.x
            : Math.max(
                workAreaPosition.x,
                workAreaPosition.x + workAreaSize.width - windowSize.width,
              );
        const y =
          workAreaPosition.y + Math.max(0, (workAreaSize.height - windowSize.height) / 2);
        await currentWindow.setPosition(
          new LogicalPosition(Math.round(x), Math.round(y)),
        );
      } catch (caught: unknown) {
        console.error("Failed to position window:", caught);
        addToast("Window placement could not be changed.", "warning");
      }
    },
    [addToast],
  );

  useEffect(() => {
    const saved = localStorage.getItem("prompt-vault-window-placement");
    if (saved !== "left" && saved !== "right") return;
    setPlacement(saved);
    void positionWindow(saved);
  }, [positionWindow]);

  const handlePlacementChange = async (
    nextPlacement: WindowPlacement,
  ): Promise<void> => {
    setPlacement(nextPlacement);
    localStorage.setItem("prompt-vault-window-placement", nextPlacement);
    await positionWindow(nextPlacement);
  };

  const resetRecovery = (): void => {
    setSourceKind(null);
    setSourceName(null);
    setSourceContent(null);
    setValidation(null);
    setPlan(null);
    setConfirmed(false);
    setRestoreResult(null);
    setLegacyPreview(null);
    setError(null);
  };

  const handleExport = async (): Promise<void> => {
    setIsExporting(true);
    setError(null);
    try {
      const exportedAt = new Date().toISOString();
      const { content, verification } = await exportVerifiedBackup(exportedAt);
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `prompt-vault-backup-${exportedAt.slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      const metadata: LastBackupMetadata = {
        timestamp: exportedAt,
        backupFormat: "2.0",
        promptCount: verification.promptCount,
        versionCount: verification.versionCount,
        verificationResult: "verified",
      };
      localStorage.setItem(LAST_BACKUP_KEY, JSON.stringify(metadata));
      setLastBackup(metadata);
      addToast("Full-history backup verified and exported.", "success");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Backup export failed.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileSelection = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    resetRecovery();
    setSourceKind("backup");
    setSourceName(file.name);
    setIsPreviewing(true);
    try {
      const content = await file.text();
      setSourceContent(content);
      const preview = await previewBackupRestore(content);
      setValidation(preview.validation);
      setPlan(preview.plan ?? null);
      if (!preview.validation.valid) {
        setError("Validation failed. No data was changed.");
      }
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Backup preview failed.");
    } finally {
      input.value = "";
      setIsPreviewing(false);
    }
  };

  const handleLegacyInspection = async (): Promise<void> => {
    setIsCheckingLegacy(true);
    setError(null);
    try {
      setLegacyStatus(await inspectLegacySource());
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Legacy inspection failed.");
    } finally {
      setIsCheckingLegacy(false);
    }
  };

  const handleLegacyPreview = async (): Promise<void> => {
    resetRecovery();
    setSourceKind("legacy");
    setSourceName(legacyStatus?.fileName ?? "historical database");
    setIsPreviewing(true);
    try {
      const result = await previewLegacyRestore();
      setLegacyPreview(result.preview);
      setLegacyStatus(result.preview.status);
      setPlan(result.plan);
      setValidation({
        valid: true,
        format: result.preview.document.format,
        version: result.preview.document.sourceVersion,
        exportedAt: result.preview.document.exportedAt,
        promptCount: result.preview.document.prompts.length,
        versionCount: result.preview.document.prompts.reduce(
          (count, prompt) => count + prompt.versions.length,
          0,
        ),
        validRecordCount: result.preview.document.prompts.length,
        invalidRecordCount: 0,
        warnings: result.preview.status.warnings,
        errors: [],
        latestVersionOnly: false,
        unsupportedVersion: false,
        document: result.preview.document,
      });
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Legacy preview failed.");
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleExecute = async (): Promise<void> => {
    if (!plan || !confirmed || isExecuting) return;
    setIsExecuting(true);
    setError(null);
    try {
      const result =
        sourceKind === "legacy"
          ? await executeLegacyRestore({
              sourceHash: legacyPreview?.sourceHash ?? "",
              plan,
              policy,
            })
          : await executeBackupRestore({
              content: sourceContent ?? "",
              plan,
              policy,
            });
      setRestoreResult(result);
      setConfirmed(false);
      addToast("Restore completed and verified.", "success");
      await loadStorageStatus();
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      if (/changed after preview|stale/i.test(message)) {
        setPlan(null);
        setConfirmed(false);
      }
    } finally {
      setIsExecuting(false);
    }
  };

  const planCounts = useMemo(() => {
    if (!plan) return [];
    const counts = new Map<string, number>();
    for (const entry of plan.entries) {
      counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, [plan]);

  const copyEvidence = async (): Promise<void> => {
    const evidence = {
      runtime: storage?.runtime ?? "unavailable",
      storage: storage?.storage ?? "unavailable",
      databasePath: storage?.databasePath ? "[private path omitted]" : null,
      counts: storage
        ? {
            prompts: storage.promptCount,
            versions: storage.versionCount,
            tags: storage.tagCount,
            relationships: storage.relationshipCount,
          }
        : null,
      integrity: storage?.integrityStatus ?? "unavailable",
      source: sourceKind,
      sourceName: sourceName ? "[private source name omitted]" : null,
      sourceFormat: validation?.version ?? null,
      policy: restoreResult?.policy ?? policy,
      result: restoreResult,
    };
    await navigator.clipboard.writeText(JSON.stringify(evidence, null, 2));
    addToast("Path-redacted recovery evidence copied.", "success");
  };

  return (
    <section className="settings-page settings-page--simplified">
      <header className="form-heading">
        <div>
          <h2>Settings</h2>
          <p>Appearance, placement, and trustworthy local recovery.</p>
        </div>
      </header>

      <section className="settings-section">
        <h3>Appearance</h3>
        <div className="settings-row">
          <div>
            <strong>Theme</strong>
            <p>Use the light or dark interface.</p>
          </div>
          <button type="button" className="secondary-action" onClick={toggleTheme}>
            {theme === "dark" ? "Switch to light" : "Switch to dark"}
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3>Window placement</h3>
        <div className="segmented-control" aria-label="Window placement">
          {(["left", "right"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={placement === value ? "is-active" : ""}
              onClick={() => void handlePlacementChange(value)}
            >
              {value === "left" ? "Left" : "Right"}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section data-safety" id="data">
        <h3>Data safety and recovery</h3>
        <p>{storage?.plaintextWarning ?? "Loading local storage status…"}</p>
        {storage && (
          <dl className="storage-status" aria-label="Storage status">
            <div><dt>Runtime</dt><dd>{storage.runtime}</dd></div>
            <div><dt>Storage</dt><dd>{storage.storage}</dd></div>
            {storage.databasePath && <div><dt>Private database path</dt><dd className="private-path">{storage.databasePath}</dd></div>}
            <div><dt>Database size</dt><dd>{formatBytes(storage.databaseSize)}</dd></div>
            <div><dt>Schema</dt><dd>{storage.sqliteUserVersion ?? "Unavailable"}</dd></div>
            <div><dt>Records</dt><dd>{storage.promptCount ?? "?"} prompts · {storage.versionCount ?? "?"} versions · {storage.tagCount ?? "?"} tags · {storage.relationshipCount ?? "?"} links</dd></div>
            {storage.storage === "sqlite" && <div><dt>WAL / SHM</dt><dd>{storage.walExists ? formatBytes(storage.walSize) : "No WAL"} · {storage.shmExists ? formatBytes(storage.shmSize) : "No SHM"}</dd></div>}
            <div><dt>Integrity</dt><dd>{storage.integrityStatus}</dd></div>
          </dl>
        )}
        {storageError && <p className="error" role="alert">{storageError}</p>}
        <div className="data-actions data-actions--compact">
          <button type="button" onClick={() => void handleExport()} disabled={isExporting}>
            {isExporting ? "Verifying export…" : "Export verified backup 2.0"}
          </button>
          {storage?.storage === "sqlite" && (
            <button type="button" className="secondary-action" onClick={() => void loadStorageStatus(true)} disabled={isCheckingIntegrity}>
              {isCheckingIntegrity ? "Checking…" : "Verify database integrity"}
            </button>
          )}
        </div>
        {lastBackup && (
          <p className="quiet-status">
            Last verified backup: {new Date(lastBackup.timestamp).toLocaleString()} · {lastBackup.promptCount} prompts · {lastBackup.versionCount} versions
          </p>
        )}

        <div className="recovery-workflow" aria-labelledby="restore-heading">
          <h4 id="restore-heading">Restore from backup</h4>
          <ol className="workflow-steps" aria-label="Restore workflow">
            <li>Choose source</li><li>Validate</li><li>Preview</li><li>Policy</li><li>Confirm</li><li>Execute</li><li>Verify</li>
          </ol>
          <label className="import-button secondary-action">
            {isPreviewing ? "Validating…" : "Choose backup JSON"}
            <input type="file" accept=".json,application/json" onChange={(event) => void handleFileSelection(event)} disabled={isPreviewing || isExecuting} className="import-input" />
          </label>
          {sourceName && <p className="source-name" title={sourceName}>Selected: {sourceName}</p>}

          {validation && (
            <section className="recovery-preview" aria-live="polite">
              <h5>{validation.valid ? "Validation complete" : "Validation failed"}</h5>
              <p>Format {validation.version ?? "unknown"} · {validation.promptCount} prompts · {validation.versionCount} versions</p>
              {validation.latestVersionOnly && <p className="warning">Backup 1.0 is latest-version-only. Absent history was not preserved or verified.</p>}
              {validation.warnings.map((warning) => <p key={warning} className="warning">{warning}</p>)}
              {validation.errors.map((message) => <p key={message} className="error">{message}</p>)}
            </section>
          )}

          {plan && !restoreResult && (
            <section className="recovery-plan" aria-label="Restore plan">
              <h5>Previewed restore plan</h5>
              <ul>
                {planCounts.map(([kind, count]) => <li key={kind}>{conflictLabel(kind as RestorePlan["entries"][number]["kind"])}: {count}</li>)}
              </ul>
              <label>
                Conflict policy
                <select value={policy} onChange={(event) => { setPolicy(event.target.value as RestorePolicy); setConfirmed(false); }} disabled={isExecuting}>
                  <option value="skip-existing">Skip existing</option>
                  <option value="add-missing-versions">Add missing versions</option>
                  <option value="import-as-copy">Import conflicts as copies</option>
                </select>
              </label>
              <label className="checkbox-field recovery-confirmation">
                <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={isExecuting} />
                Confirm {validation?.promptCount ?? plan.entries.length} prompt records using {policy.replaceAll("-", " ")}
              </label>
              <div className="data-actions data-actions--compact">
                <button type="button" onClick={() => void handleExecute()} disabled={!confirmed || isExecuting}>
                  {isExecuting ? "Restoring…" : "Execute transactional restore"}
                </button>
                <button type="button" className="secondary-action" onClick={resetRecovery} disabled={isExecuting}>Cancel preview</button>
              </div>
            </section>
          )}

          {restoreResult && (
            <section className="recovery-result" aria-live="polite">
              <h5>Restore verified</h5>
              <p>{restoreResult.newPrompts} new · {restoreResult.copiedPrompts} copied · {restoreResult.mergedVersions} versions merged · {restoreResult.skippedPrompts} prompts skipped · {restoreResult.skippedVersions} versions skipped</p>
              <p>Integrity: {restoreResult.integrityResult} · foreign-key violations: {restoreResult.foreignKeyViolationCount}</p>
              <div className="data-actions data-actions--compact">
                <button type="button" className="secondary-action" onClick={() => void copyEvidence()}>Copy redacted evidence</button>
                <button type="button" className="secondary-action" onClick={resetRecovery}>Start a new preview</button>
              </div>
            </section>
          )}
        </div>

        <div className="legacy-recovery">
          <h4>Historical desktop database</h4>
          <p>Detection and recovery are native Windows-only, read-only until you explicitly confirm a restore, and never automatic.</p>
          <button type="button" className="secondary-action" onClick={() => void handleLegacyInspection()} disabled={!isTauriAvailable() || isCheckingLegacy || isExecuting}>
            {isCheckingLegacy ? "Inspecting read-only…" : "Check historical database"}
          </button>
          {!isTauriAvailable() && <p className="quiet-status">Legacy database recovery is unavailable in browser fallback.</p>}
          {legacyStatus && (
            <div className="legacy-status" aria-live="polite">
              <p>Status: <strong>{legacyStatus.state.replaceAll("-", " ")}</strong></p>
              {legacyStatus.state === "compatible" && <p>{legacyStatus.promptCount ?? 0} prompts · {legacyStatus.versionCount ?? 0} versions · source SHA-256 recorded</p>}
              {legacyStatus.warnings.map((warning) => <p key={warning} className="warning">{warning}</p>)}
              {legacyStatus.state === "compatible" && (
                <button type="button" className="secondary-action" onClick={() => void handleLegacyPreview()} disabled={isPreviewing || isExecuting}>Preview historical recovery</button>
              )}
            </div>
          )}
        </div>

        {error && <p className="error" role="alert" aria-live="assertive">{error}</p>}
      </section>

      <section className="settings-section settings-section--quiet">
        <h3>Advanced tools</h3>
        <p>Raw bundle tooling and bulk administration stay separate from everyday recovery.</p>
        <Link className="secondary-action inline-action" to="/advanced">Open advanced tools</Link>
      </section>

      <footer className="settings-footer">
        <span>Backups and databases are plaintext local data.</span>
        <button type="button" className="text-button" onClick={() => navigate(-1)}>Done</button>
      </footer>
    </section>
  );
}
