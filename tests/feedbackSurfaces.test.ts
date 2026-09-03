import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SURFACE_FILES = [
  "desktop/src/components/Layout.tsx",
  "desktop/src/components/PromptList.tsx",
  "desktop/src/components/PromptRowActions.tsx",
  "desktop/src/pages/LibraryPage.tsx",
  "desktop/src/pages/CreatePromptPage.tsx",
  "desktop/src/pages/EditPromptPage.tsx",
  "desktop/src/pages/SettingsPage.tsx",
  "desktop/src/pages/PromptListPage.tsx",
] as const;

const sources = SURFACE_FILES.map((path) => ({
  path,
  source: readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
}));

const REQUIRED_STATIC_IDS = [
  "prompt-vault.shell",
  "prompt-vault.brand",
  "prompt-vault.navigation.primary",
  "prompt-vault.workspace",
  "prompt-vault.library.workspace",
  "prompt-vault.library.search",
  "prompt-vault.library.filters",
  "prompt-vault.library.sort",
  "prompt-vault.library.results",
  "prompt-vault.library.new",
  "prompt-vault.editor.create",
  "prompt-vault.editor.create.title",
  "prompt-vault.editor.create.body",
  "prompt-vault.editor.create.options",
  "prompt-vault.editor.create.clear",
  "prompt-vault.editor.create.cancel",
  "prompt-vault.editor.create.save",
  "prompt-vault.editor.edit",
  "prompt-vault.editor.edit.title",
  "prompt-vault.editor.edit.body",
  "prompt-vault.editor.edit.save",
  "prompt-vault.editor.version-history",
  "prompt-vault.editor.version-preview",
  "prompt-vault.settings.workspace",
  "prompt-vault.settings.backup.export",
  "prompt-vault.settings.recovery.file",
  "prompt-vault.settings.recovery.preview",
  "prompt-vault.settings.recovery.confirmation",
  "prompt-vault.settings.recovery.apply",
  "prompt-vault.settings.storage.integrity",
  "prompt-vault.advanced.workspace",
  "prompt-vault.advanced.bundle.export-json",
  "prompt-vault.advanced.bundle.import-json",
] as const;

const PRIVATE_STATIC_IDS = [
  "prompt-vault.library.search",
  "prompt-vault.editor.create",
  "prompt-vault.editor.create.title",
  "prompt-vault.editor.create.body",
  "prompt-vault.editor.create.tags",
  "prompt-vault.editor.create.category",
  "prompt-vault.editor.create.rating",
  "prompt-vault.editor.edit",
  "prompt-vault.editor.edit.title",
  "prompt-vault.editor.edit.body",
  "prompt-vault.editor.edit.tags",
  "prompt-vault.editor.edit.category",
  "prompt-vault.editor.edit.rating",
  "prompt-vault.editor.edit.version",
  "prompt-vault.editor.edit.changelog",
  "prompt-vault.editor.version-preview",
  "prompt-vault.editor.version-preview.body",
  "prompt-vault.settings.storage.status",
  "prompt-vault.settings.recovery",
  "prompt-vault.settings.recovery.file",
  "prompt-vault.settings.recovery.preview",
  "prompt-vault.settings.recovery.policy",
  "prompt-vault.settings.recovery.legacy",
  "prompt-vault.advanced.workspace",
  "prompt-vault.advanced.search",
  "prompt-vault.advanced.filters.tag",
  "prompt-vault.advanced.filters.category",
  "prompt-vault.advanced.filters.project-tag",
  "prompt-vault.advanced.bundle.content",
  "prompt-vault.advanced.bulk.tags",
] as const;

function openingTagFor(id: string): string {
  for (const { source } of sources) {
    const marker = `data-feedback-id="${id}"`;
    const markerIndex = source.indexOf(marker);
    if (markerIndex < 0) continue;
    const start = source.lastIndexOf("<", markerIndex);
    const end = source.indexOf(">", markerIndex);
    if (start >= 0 && end >= 0) return source.slice(start, end + 1);
  }
  throw new Error(`Static Feedback Layer anchor not found: ${id}`);
}

describe("Prompt Vault Feedback Layer surface inventory", () => {
  it("uses unique product-semantic static identifiers with bounded syntax", () => {
    const ids = sources.flatMap(({ source }) =>
      [...source.matchAll(/data-feedback-id="([^"]+)"/g)].map(
        (match) => match[1] as string,
      ),
    );

    expect(ids.length).toBeGreaterThanOrEqual(REQUIRED_STATIC_IDS.length);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^prompt-vault(?:\.[a-z0-9-]+)+$/);
      expect(id.length).toBeLessThanOrEqual(160);
    }
    expect(ids).toEqual(expect.arrayContaining(REQUIRED_STATIC_IDS));
  });

  it("keeps private and redaction declarations explicit on value-bearing surfaces", () => {
    for (const id of PRIVATE_STATIC_IDS) {
      const openingTag = openingTagFor(id);
      expect(openingTag, id).toContain("data-feedback-private");
      expect(openingTag, id).toContain("data-feedback-redact");
    }
  });

  it("keeps dynamic prompt anchors validated and private at their rendered row", () => {
    const promptList = sources.find(
      ({ path }) => path === "desktop/src/components/PromptList.tsx",
    )?.source;
    const promptRowActions = sources.find(
      ({ path }) => path === "desktop/src/components/PromptRowActions.tsx",
    )?.source;
    expect(promptList).toContain("promptFeedbackId(prompt.id)");
    expect(promptList).toContain(
      'promptFeedbackId(prompt.id, "copy")',
    );
    expect(promptRowActions).toContain(
      'promptFeedbackId(prompt.id, "favorite")',
    );
    expect(promptRowActions).toContain(
      'promptFeedbackId(prompt.id, "edit")',
    );
    expect(promptList).toMatch(
      /data-feedback-id=\{feedbackId\}[\s\S]{0,100}data-feedback-private[\s\S]{0,100}data-feedback-redact/,
    );
  });

  it("does not encode repository paths or private values in static semantic IDs", () => {
    const serialized = JSON.stringify(
      sources.flatMap(({ source }) =>
        [...source.matchAll(/data-feedback-id="([^"]+)"/g)].map(
          (match) => match[1],
        ),
      ),
    );
    expect(serialized).not.toContain(REPOSITORY_ROOT.replaceAll("\\", "/"));
    expect(serialized).not.toMatch(/prompt title|prompt body|127\.0\.0\.1|project_/i);
  });
});
