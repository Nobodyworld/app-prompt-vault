import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { isTauriAvailable } from "../lib/tauri";
import { listPrompts, createPrompt } from "../services/promptApi";
import { useToast } from "../components/Toast";
import { useTheme } from "../components/ThemeProvider";

type WindowPlacement = "left" | "right";

export function SettingsPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const [placement, setPlacement] = useState<WindowPlacement>("left");
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [promptStats, setPromptStats] = useState<{
    total: number;
    withTags: number;
    totalTags: number;
    avgTagsPerPrompt: number;
    mostUsedTag: string | null;
  } | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(
      "prompt-vault-window-placement",
    ) as WindowPlacement;
    if (saved) setPlacement(saved);
  }, []);

  useEffect(() => {
    const loadStats = async (): Promise<void> => {
      try {
        const prompts = await listPrompts();
        const total = prompts.length;
        const withTags = prompts.filter((p) => p.tags.length > 0).length;
        const allTags = prompts.flatMap((p) => p.tags);
        const totalTags = allTags.length;
        const avgTagsPerPrompt = total > 0 ? totalTags / total : 0;

        // Find most used tag
        const tagCounts: Record<string, number> = {};
        allTags.forEach((tag) => {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
        const mostUsedTag =
          Object.entries(tagCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ||
          null;

        setPromptStats({
          total,
          withTags,
          totalTags,
          avgTagsPerPrompt: Math.round(avgTagsPerPrompt * 10) / 10,
          mostUsedTag,
        });
      } catch (err) {
        console.error("Failed to load prompt stats:", err);
      }
    };

    void loadStats();
  }, []);

  const positionWindow = async (
    newPlacement: WindowPlacement,
  ): Promise<void> => {
    if (!isTauriAvailable()) {
      // Running in browser/dev server: skip Tauri-only window positioning.
      return;
    }
    try {
      const { getCurrentWindow, LogicalPosition } =
        await import("@tauri-apps/api/window");
      const window = getCurrentWindow();

      // Get screen dimensions
      const { currentMonitor } = await import("@tauri-apps/api/window");
      const monitor = await currentMonitor();
      if (!monitor) return;

      const screenWidth = monitor.size.width;
      const screenHeight = monitor.size.height;
      const windowWidth = 500; // from tauri.conf.json
      const windowHeight = 800; // from tauri.conf.json

      let x: number;
      if (newPlacement === "left") {
        x = 0;
      } else {
        x = screenWidth - windowWidth;
      }

      const y = Math.max(0, (screenHeight - windowHeight) / 2);

      await window.setPosition(new LogicalPosition(x, y));
    } catch (error) {
      console.error("Failed to position window:", error);
    }
  };

  const handlePlacementChange = async (
    newPlacement: WindowPlacement,
  ): Promise<void> => {
    setPlacement(newPlacement);
    localStorage.setItem("prompt-vault-window-placement", newPlacement);
    await positionWindow(newPlacement);
  };

  const handleExport = async (): Promise<void> => {
    if (!isTauriAvailable()) {
      setExportError("Export is only available in the desktop app.");
      return;
    }

    setIsExporting(true);
    setExportError(null);

    try {
      const prompts = await listPrompts();

      // Create export data with full prompt information
      const exportData = {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        prompts: prompts.map((prompt) => ({
          id: prompt.id,
          slug: prompt.slug,
          title: prompt.title,
          description: prompt.description,
          tags: prompt.tags,
          createdAt: prompt.createdAt,
          updatedAt: prompt.updatedAt,
          body: prompt.latestVersion?.body || "",
          version: prompt.latestVersion?.semanticVersion || "1.0.0",
        })),
      };

      // Convert to JSON and trigger download
      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      // Create download link and trigger it
      const a = document.createElement("a");
      a.href = url;
      a.download = `prompt-vault-export-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setExportError(
        err instanceof Error ? err.message : "Failed to export prompts",
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!isTauriAvailable()) {
      setImportError("Import is only available in the desktop app.");
      return;
    }

    setIsImporting(true);
    setImportError(null);

    try {
      const text = await file.text();
      const importData = JSON.parse(text) as {
        version: string;
        prompts: Array<{
          slug: string;
          title: string;
          description?: string;
          tags: string[];
          body: string;
          version: string;
        }>;
      };

      if (!importData.prompts || !Array.isArray(importData.prompts)) {
        throw new Error("Invalid import file format");
      }

      let importedCount = 0;
      for (const promptData of importData.prompts) {
        try {
          await createPrompt({
            slug: promptData.slug,
            title: promptData.title,
            description: promptData.description,
            body: promptData.body,
            semanticVersion: promptData.version || "1.0.0",
            tags: promptData.tags || [],
          });
          importedCount++;
        } catch (err: unknown) {
          console.warn(`Failed to import prompt "${promptData.title}":`, err);
          // Continue with other prompts
        }
      }

      addToast(
        `Successfully imported ${importedCount} prompt${importedCount === 1 ? "" : "s"}.`,
        "success",
      );

      // Clear the file input
      event.target.value = "";
    } catch (err: unknown) {
      setImportError(
        err instanceof Error ? err.message : "Failed to import prompts",
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="settings-page">
      <header>
        <h2>Settings</h2>
      </header>

      <div className="settings-section">
        <h3>Window Placement</h3>
        <div className="placement-options">
          <label>
            <input
              type="radio"
              name="placement"
              value="left"
              checked={placement === "left"}
              onChange={() => handlePlacementChange("left")}
            />
            Left Sidebar
          </label>
          <label>
            <input
              type="radio"
              name="placement"
              value="right"
              checked={placement === "right"}
              onChange={() => handlePlacementChange("right")}
            />
            Right Sidebar
          </label>
        </div>
      </div>

      <div className="settings-section">
        <h3>Keyboard Shortcuts</h3>
        <div className="keyboard-shortcuts">
          <div className="shortcut-item">
            <kbd>Ctrl+N</kbd>
            <span>Create new prompt</span>
          </div>
          <div className="shortcut-item">
            <kbd>Ctrl+K</kbd>
            <span>Focus search (on Library page)</span>
          </div>
          <div className="shortcut-item">
            <kbd>Esc</kbd>
            <span>Clear search (on Library page)</span>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Data Management</h3>
        <div className="data-actions">
          <div className="data-action-group">
            <button
              onClick={handleExport}
              disabled={isExporting || !isTauriAvailable()}
              className="export-button"
            >
              {isExporting ? "Exporting..." : "Export Prompts"}
            </button>
            <p className="data-description">
              Export all your prompts as a JSON file for backup or migration.
            </p>
          </div>

          <div className="data-action-group">
            <label className="import-button">
              {isImporting ? "Importing..." : "Import Prompts"}
              <input
                type="file"
                accept=".json"
                onChange={handleImport}
                disabled={isImporting || !isTauriAvailable()}
                className="import-input"
              />
            </label>
            <p className="data-description">
              Import prompts from a JSON export file.
            </p>
          </div>
        </div>
        {exportError && <p className="error">{exportError}</p>}
        {importError && <p className="error">{importError}</p>}
      </div>

      <div className="settings-section">
        <h3>Usage Analytics</h3>
        {promptStats ? (
          <div className="analytics-grid">
            <div className="stat-card">
              <div className="stat-value">{promptStats.total}</div>
              <div className="stat-label">Total Prompts</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{promptStats.withTags}</div>
              <div className="stat-label">Tagged Prompts</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{promptStats.totalTags}</div>
              <div className="stat-label">Total Tags</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{promptStats.avgTagsPerPrompt}</div>
              <div className="stat-label">Avg Tags/Prompt</div>
            </div>
            {promptStats.mostUsedTag && (
              <div className="stat-card stat-card--wide">
                <div className="stat-value">#{promptStats.mostUsedTag}</div>
                <div className="stat-label">Most Used Tag</div>
              </div>
            )}
          </div>
        ) : (
          <p className="stat-loading">Loading statistics...</p>
        )}
      </div>

      <div className="settings-section">
        <h3>Appearance</h3>
        <div className="theme-toggle">
          <label className="theme-toggle__label">
            Theme
            <button
              type="button"
              onClick={toggleTheme}
              className="theme-toggle__button"
            >
              {theme === "dark" ? "🌙 Dark" : "☀️ Light"}
            </button>
          </label>
        </div>
      </div>

      <div className="form-actions">
        <button onClick={() => navigate(-1)}>Save</button>
      </div>
    </div>
  );
}
