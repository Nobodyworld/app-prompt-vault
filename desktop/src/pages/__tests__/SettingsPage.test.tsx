// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { RestorePlan, StorageStatus } from "../../../../src/domain/recovery";
import { SettingsPage } from "../SettingsPage";

const api = vi.hoisted(() => ({
  executeBackupRestore: vi.fn(),
  executeLegacyRestore: vi.fn(),
  exportVerifiedBackup: vi.fn(),
  getStorageStatus: vi.fn(),
  inspectLegacySource: vi.fn(),
  previewBackupRestore: vi.fn(),
  previewLegacyRestore: vi.fn(),
}));

const runtime = vi.hoisted(() => ({ native: false }));
const toast = vi.hoisted(() => ({ addToast: vi.fn() }));

vi.mock("../../services/promptApi", () => api);
vi.mock("../../lib/tauri", () => ({ isTauriAvailable: () => runtime.native }));
vi.mock("../../components/ThemeProvider", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }),
}));
vi.mock("../../components/Toast", () => ({ useToast: () => toast }));

const browserStatus: StorageStatus = {
  runtime: "browser-fallback",
  storage: "localStorage",
  databasePath: null,
  databaseExists: null,
  databaseSize: null,
  sqliteUserVersion: null,
  promptCount: 1,
  versionCount: 2,
  tagCount: null,
  relationshipCount: null,
  walExists: null,
  walSize: null,
  shmExists: null,
  shmSize: null,
  integrityStatus: "unavailable",
  nativeSqliteAvailable: false,
  legacyRecoveryAvailable: false,
  plaintextWarning: "Browser fallback stores plaintext prompt data in localStorage.",
};

const plan: RestorePlan = {
  planVersion: "1",
  planId: "a".repeat(64),
  sourceVersion: "2.0",
  documentFingerprint: "b".repeat(64),
  currentLibraryFingerprint: "c".repeat(64),
  entries: [
    {
      sourceSlug: "new-source",
      kind: "new-prompt",
      currentPromptId: null,
      missingVersionIdentities: ["1.0.0\0hash"],
      skippedVersionIdentities: [],
      copySlug: null,
      copyTitle: null,
    },
  ],
  warnings: [],
};

const validPreview = {
  validation: {
    valid: true,
    format: "prompt-vault-backup",
    version: "2.0",
    exportedAt: "2026-01-01T00:00:00.000Z",
    promptCount: 1,
    versionCount: 2,
    validRecordCount: 1,
    invalidRecordCount: 0,
    warnings: [],
    errors: [],
    latestVersionOnly: false,
    unsupportedVersion: false,
  },
  plan,
};

function renderSettings(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={["/settings"]}>
      <SettingsPage />
    </MemoryRouter>,
  );
}

async function selectBackup(container: HTMLElement, content = "{}"): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  const file = new File([content], "a-very-long-private-backup-file-name.json", {
    type: "application/json",
  });
  Object.defineProperty(file, "text", {
    configurable: true,
    value: async () => content,
  });
  fireEvent.change(input!, { target: { files: [file] } });
  await screen.findByText("Validation complete");
}

describe("Settings data safety and recovery", () => {
  beforeEach(() => {
    runtime.native = false;
    localStorage.clear();
    api.getStorageStatus.mockReset().mockResolvedValue(browserStatus);
    api.previewBackupRestore.mockReset().mockResolvedValue(validPreview);
    api.executeBackupRestore.mockReset().mockResolvedValue({
      sourceFormat: "2.0",
      policy: "skip-existing",
      newPrompts: 1,
      copiedPrompts: 0,
      mergedVersions: 0,
      skippedPrompts: 0,
      skippedVersions: 0,
      invalidRecords: 0,
      warnings: [],
      integrityResult: "unavailable",
      foreignKeyViolationCount: 0,
    });
    api.exportVerifiedBackup.mockReset().mockResolvedValue({
      content: "{}",
      verification: {
        verified: true,
        promptCount: 1,
        versionCount: 2,
        deterministicOrdering: true,
        errors: [],
      },
    });
    api.inspectLegacySource.mockReset();
    api.previewLegacyRestore.mockReset();
    api.executeLegacyRestore.mockReset();
    toast.addToast.mockReset();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("reports honest browser limitations and stores only verified backup metadata", async () => {
    renderSettings();
    expect(await screen.findByText("browser-fallback")).toBeVisible();
    expect(screen.getByText(/Legacy database recovery is unavailable/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Export verified backup 2.0" }));
    await waitFor(() => expect(api.exportVerifiedBackup).toHaveBeenCalledTimes(1));
    const stored = JSON.parse(localStorage.getItem("prompt-vault:last-backup:v1") ?? "null");
    expect(stored).toMatchObject({
      backupFormat: "2.0",
      promptCount: 1,
      versionCount: 2,
      verificationResult: "verified",
    });
    expect(stored).not.toHaveProperty("path");
    expect(stored).not.toHaveProperty("prompts");
  });

  it("validates and previews without mutation, then cancellation discards the plan", async () => {
    const { container } = renderSettings();
    await selectBackup(container);
    expect(screen.getByText("Format 2.0 · 1 prompts · 2 versions")).toBeVisible();
    expect(screen.getByText("New prompt: 1")).toBeVisible();
    expect(api.executeBackupRestore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel preview" }));
    expect(screen.queryByText("Previewed restore plan")).not.toBeInTheDocument();
    expect(api.executeBackupRestore).not.toHaveBeenCalled();
  });

  it("rejects invalid validation and never exposes an execute action", async () => {
    api.previewBackupRestore.mockResolvedValue({
      validation: {
        ...validPreview.validation,
        valid: false,
        errors: ["prompts[0].semanticVersion must follow MAJOR.MINOR.PATCH."],
      },
    });
    const { container } = renderSettings();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const invalidFile = new File(["bad"], "bad.json");
    Object.defineProperty(invalidFile, "text", {
      configurable: true,
      value: async () => "bad",
    });
    fireEvent.change(input, { target: { files: [invalidFile] } });
    expect(await screen.findByText("Validation failed")).toBeVisible();
    expect(screen.getByText(/MAJOR\.MINOR\.PATCH/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Execute transactional restore" })).not.toBeInTheDocument();
    expect(api.executeBackupRestore).not.toHaveBeenCalled();
  });

  it("contains duplicate submissions and shows a verified result", async () => {
    let resolveExecution: (value: unknown) => void = () => undefined;
    api.executeBackupRestore.mockReturnValue(
      new Promise((resolve) => {
        resolveExecution = resolve;
      }),
    );
    const { container } = renderSettings();
    await selectBackup(container, "source-content");
    fireEvent.click(screen.getByRole("checkbox"));
    const execute = screen.getByRole("button", {
      name: "Execute transactional restore",
    });
    fireEvent.click(execute);
    fireEvent.click(execute);
    expect(api.executeBackupRestore).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Restoring…" })).toBeDisabled();
    resolveExecution({
      sourceFormat: "2.0",
      policy: "skip-existing",
      newPrompts: 1,
      copiedPrompts: 0,
      mergedVersions: 0,
      skippedPrompts: 0,
      skippedVersions: 0,
      invalidRecords: 0,
      warnings: [],
      integrityResult: "ok",
      foreignKeyViolationCount: 0,
    });
    expect(await screen.findByText("Restore verified")).toBeVisible();
    expect(screen.getByText(/foreign-key violations: 0/)).toBeVisible();
  });

  it("requires a fresh preview after a stale-plan failure", async () => {
    api.executeBackupRestore.mockRejectedValue(
      new Error("The current library changed after preview. Create a new preview."),
    );
    const { container } = renderSettings();
    await selectBackup(container);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Execute transactional restore" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/changed after preview/);
    expect(screen.queryByText("Previewed restore plan")).not.toBeInTheDocument();
  });

  it("shows storage and execution failures without claiming a restore", async () => {
    api.getStorageStatus.mockRejectedValueOnce(new Error("Storage inventory failed."));
    const first = renderSettings();
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage inventory failed.");
    first.unmount();

    api.getStorageStatus.mockResolvedValue(browserStatus);
    api.executeBackupRestore.mockRejectedValueOnce(
      new Error("Injected transactional failure; all writes rolled back."),
    );
    const { container } = renderSettings();
    await selectBackup(container, "rollback-source");
    fireEvent.change(screen.getByRole("combobox", { name: "Conflict policy" }), {
      target: { value: "import-as-copy" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Execute transactional restore" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/all writes rolled back/);
    expect(api.executeBackupRestore).toHaveBeenCalledWith(
      expect.objectContaining({ policy: "import-as-copy" }),
    );
    expect(screen.getByText("Previewed restore plan")).toBeVisible();
    expect(screen.queryByText("Restore verified")).not.toBeInTheDocument();
  });

  it("copies a path-redacted evidence result without backup content or source name", async () => {
    const { container } = renderSettings();
    await selectBackup(container, "private prompt body");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Execute transactional restore" }),
    );
    await screen.findByText("Restore verified");
    fireEvent.click(screen.getByRole("button", { name: "Copy redacted evidence" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1));
    const evidence = JSON.parse(
      vi.mocked(navigator.clipboard.writeText).mock.calls[0][0] as string,
    );
    expect(evidence).toMatchObject({
      runtime: "browser-fallback",
      databasePath: null,
      source: "backup",
      sourceName: "[private source name omitted]",
      sourceFormat: "2.0",
    });
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain("private prompt body");
    expect(serialized).not.toContain("a-very-long-private-backup-file-name.json");
  });

  it("keeps historical database inspection manual and requires preview before execution", async () => {
    runtime.native = true;
    const legacyStatus = {
      state: "compatible" as const,
      fileName: "prompt-vault.db",
      fileSize: 4096,
      sha256: "d".repeat(64),
      sqliteUserVersion: 2,
      recognizedSchema: "prompt-vault-sqlite-v1",
      promptCount: 1,
      versionCount: 2,
      tagCount: 1,
      relationshipCount: 1,
      integrityStatus: "ok" as const,
      warnings: [],
    };
    const document = {
      format: "prompt-vault-backup" as const,
      sourceVersion: "2.0" as const,
      exportedAt: "2026-01-01T00:00:00.000Z",
      historyCoverage: "full-history" as const,
      prompts: [],
    };
    api.inspectLegacySource.mockResolvedValue(legacyStatus);
    api.previewLegacyRestore.mockResolvedValue({
      preview: { status: legacyStatus, sourceHash: legacyStatus.sha256, document },
      plan,
    });
    api.executeLegacyRestore.mockResolvedValue({
      sourceFormat: "2.0",
      policy: "skip-existing",
      newPrompts: 0,
      copiedPrompts: 0,
      mergedVersions: 0,
      skippedPrompts: 0,
      skippedVersions: 0,
      invalidRecords: 0,
      warnings: [],
      integrityResult: "ok",
      foreignKeyViolationCount: 0,
    });
    renderSettings();
    expect(api.inspectLegacySource).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Check historical database" }));
    expect(await screen.findByText(/Status:/)).toHaveTextContent("compatible");
    expect(api.previewLegacyRestore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Preview historical recovery" }));
    expect(await screen.findByText("Previewed restore plan")).toBeVisible();
    expect(api.executeLegacyRestore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Execute transactional restore" }),
    );
    await screen.findByText("Restore verified");
    expect(api.executeLegacyRestore).toHaveBeenCalledWith({
      sourceHash: legacyStatus.sha256,
      plan,
      policy: "skip-existing",
    });
  });
});
