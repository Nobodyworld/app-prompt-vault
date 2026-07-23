import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTheme } from "../components/ThemeProvider";
import { useToast } from "../components/Toast";
import {
  backupPromptToCreateInput,
  buildBackupExport,
  isBackupPrompt,
} from "../lib/backup";
import { isTauriAvailable } from "../lib/tauri";
import { createPrompt, listPrompts } from "../services/promptApi";

type WindowPlacement = "left" | "right";

export function SettingsPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const [placement, setPlacement] = useState<WindowPlacement>("left");
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          workAreaPosition.y +
          Math.max(0, (workAreaSize.height - windowSize.height) / 2);

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

  const handleExport = async (): Promise<void> => {
    if (!isTauriAvailable()) {
      setError("Backup export is available in the desktop app.");
      return;
    }

    setIsExporting(true);
    setError(null);
    try {
      const prompts = await listPrompts();
      const exportData = buildBackupExport(prompts);

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `prompt-vault-backup-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      addToast("Backup exported.", "success");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Backup export failed.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    if (!isTauriAvailable()) {
      setError("Backup import is available in the desktop app.");
      input.value = "";
      return;
    }

    setIsImporting(true);
    setError(null);
    try {
      const data = JSON.parse(await file.text()) as { prompts?: unknown[] };

      if (!Array.isArray(data.prompts)) {
        throw new Error("This file is not a valid Prompt Vault backup.");
      }

      let imported = 0;
      let skipped = 0;

      for (const candidate of data.prompts) {
        if (!isBackupPrompt(candidate)) {
          skipped += 1;
          console.warn("Skipped an invalid backup prompt record.");
          continue;
        }

        try {
          await createPrompt(backupPromptToCreateInput(candidate));
          imported += 1;
        } catch (caught: unknown) {
          skipped += 1;
          console.warn(`Skipped prompt ${candidate.title}:`, caught);
        }
      }

      const importedLabel = `${imported} prompt${imported === 1 ? "" : "s"} imported`;
      const skippedLabel = `${skipped} skipped`;
      addToast(
        skipped > 0 ? `${importedLabel}; ${skippedLabel}.` : `${importedLabel}.`,
        skipped > 0 ? "warning" : "success",
      );

      if (imported === 0 && skipped > 0) {
        setError(
          "No prompts were imported. The records were invalid, duplicated, or could not be saved.",
        );
      }
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Backup import failed.");
    } finally {
      input.value = "";
      setIsImporting(false);
    }
  };

  return (
    <section className="settings-page settings-page--simplified">
      <header className="form-heading">
        <div>
          <h2>Settings</h2>
          <p>Appearance, placement, and local data controls.</p>
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
          <button
            type="button"
            className={placement === "left" ? "is-active" : ""}
            onClick={() => void handlePlacementChange("left")}
          >
            Left
          </button>
          <button
            type="button"
            className={placement === "right" ? "is-active" : ""}
            onClick={() => void handlePlacementChange("right")}
          >
            Right
          </button>
        </div>
      </section>

      <section className="settings-section" id="data">
        <h3>Backup and local data</h3>
        <p>
          Prompt Vault stores prompts locally. On Windows, the current desktop
          identifier uses <code>AppData\\Local\\com.nobodyworld.promptvault</code>.
          Uninstalling version 0.2.0 preserves that user data so reinstalling can
          recover the same library.
        </p>
        <div className="data-actions data-actions--compact">
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={isExporting || !isTauriAvailable()}
          >
            {isExporting ? "Exporting…" : "Export backup"}
          </button>
          <label className="import-button secondary-action">
            {isImporting ? "Importing…" : "Import backup"}
            <input
              type="file"
              accept=".json"
              onChange={(event) => void handleImport(event)}
              disabled={isImporting || !isTauriAvailable()}
              className="import-input"
            />
          </label>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="settings-section settings-section--quiet">
        <h3>Advanced tools</h3>
        <p>
          Raw bundle import/export, cross-app payloads, and bulk administration
          are available separately so they do not crowd the everyday library.
        </p>
        <Link className="secondary-action inline-action" to="/advanced">
          Open advanced tools
        </Link>
      </section>

      <footer className="settings-footer">
        <span>
          Shortcuts: <kbd>Ctrl+K</kbd> search · <kbd>Ctrl+N</kbd> new prompt
        </span>
        <button type="button" className="text-button" onClick={() => navigate(-1)}>
          Done
        </button>
      </footer>
    </section>
  );
}
