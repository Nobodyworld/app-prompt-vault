import { describe, expect, it } from "vitest";
import type { PromptSummary } from "../../types/prompt";
import {
  backupPromptToCreateInput,
  buildBackupExport,
  isBackupPrompt,
} from "../backup";

const prompt: PromptSummary = {
  id: "prompt-1",
  slug: "acceptance-prompt",
  title: "Acceptance prompt",
  description: "Export metadata",
  category: "Acceptance",
  isFavorite: true,
  rating: 5,
  tags: ["native", "pr43"],
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T01:00:00.000Z",
  latestVersion: {
    id: "version-2",
    semanticVersion: "1.0.1",
    updatedAt: "2026-07-22T01:00:00.000Z",
    body: "Updated prompt body",
  },
};

describe("backup serialization", () => {
  it("exports all user-editable prompt metadata with the latest body", () => {
    const result = buildBackupExport(
      [prompt],
      "2026-07-22T02:00:00.000Z",
    );

    expect(result).toEqual({
      version: "1.0",
      exportedAt: "2026-07-22T02:00:00.000Z",
      prompts: [
        expect.objectContaining({
          title: "Acceptance prompt",
          category: "Acceptance",
          isFavorite: true,
          rating: 5,
          tags: ["native", "pr43"],
          body: "Updated prompt body",
          version: "1.0.1",
        }),
      ],
    });
  });

  it("restores exported metadata and accepts older backups without it", () => {
    const exported = buildBackupExport([prompt]).prompts[0];
    expect(isBackupPrompt(exported)).toBe(true);
    expect(backupPromptToCreateInput(exported)).toEqual(
      expect.objectContaining({
        category: "Acceptance",
        isFavorite: true,
        rating: 5,
      }),
    );

    const legacy = {
      slug: "legacy",
      title: "Legacy backup",
      body: "Legacy body",
    };
    expect(isBackupPrompt(legacy)).toBe(true);
    expect(backupPromptToCreateInput(legacy)).toEqual(
      expect.objectContaining({
        category: undefined,
        isFavorite: false,
        rating: null,
      }),
    );
  });

  it("rejects invalid rating metadata", () => {
    expect(
      isBackupPrompt({
        slug: "invalid",
        title: "Invalid",
        body: "Body",
        rating: 6,
      }),
    ).toBe(false);
  });
});
