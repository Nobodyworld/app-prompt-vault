import { beforeEach, describe, expect, it, vi } from "vitest";
import { pvExportPlannerBucketHandler, pvImportPromptsHandler } from "../src/tools/index.js";

const exportPlannerDraftMock = vi.hoisted(() =>
  vi.fn(async () => ({
    name: "Prompt Vault Picks",
    source: "prompt-vault",
    tags: ["prompt-vault", "import"],
    tasks: [
      {
        title: "Use: Sample Prompt",
        note: "Body",
        tags: ["prompt-vault"],
      },
    ],
  })),
);

const importPromptsMock = vi.hoisted(() =>
  vi.fn(async (items: Array<{ title: string; content: string }>) => ({
    created: items.map((item, index) => ({
      id: `p-${index}`,
      slug: `slug-${index}`,
      title: item.title,
    })),
    failed: [],
  })),
);

vi.mock("../src/lib/promptService.js", () => ({
  exportPlannerDraft: exportPlannerDraftMock,
  importPrompts: importPromptsMock,
}));

describe("Prompt Vault import/export tools", () => {
  beforeEach(() => {
    exportPlannerDraftMock.mockClear();
    importPromptsMock.mockClear();
  });

  it("exports a Planner bucket draft using filters", async () => {
    const result = await pvExportPlannerBucketHandler(
      { limit: 5, query: "ai", tags: ["demo"], projectSlug: "proj" },
      {},
    );

    expect(result.success).toBe(true);
    expect(exportPlannerDraftMock).toHaveBeenCalledWith(
      { query: "ai", tags: ["demo"], projectSlug: "proj" },
      5,
    );
    expect(result.data).toMatchObject({ name: "Prompt Vault Picks" });
  });

  it("fails when no items are provided for import", async () => {
    const result = await pvImportPromptsHandler({}, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("items array is required");
  });

  it("imports prompts in bulk and returns a summary", async () => {
    const result = await pvImportPromptsHandler(
      { items: [{ title: "T1", content: "C1" }, { title: "T2", content: "C2" }] },
      {},
    );

    expect(result.success).toBe(true);
    expect(importPromptsMock).toHaveBeenCalledTimes(1);
    expect(result.data.created).toHaveLength(2);
    expect(result.data.failed).toEqual([]);
  });
});
