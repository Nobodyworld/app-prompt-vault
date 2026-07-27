import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prompt } from "../src/domain/models.js";
import {
  createProjectTag,
  createSharedTag,
  getProjectTagBySlug,
  listSharedTagsForEntity,
  resetCoreDb,
  tagSharedPrompt,
} from "../src/lib/platform-core.js";
import * as promptService from "../src/lib/promptService.js";

describe("promptService facade", () => {
  const mockPrompt: Prompt = {
    id: "prompt-1",
    slug: "test-prompt",
    title: "Test Prompt",
    description: undefined,
    category: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: [],
    latestVersion: {
      id: "v1",
      promptId: "prompt-1",
      semanticVersion: "1.0.0",
      body: "Hello world",
      format: "markdown",
      changelog: undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const serviceStub = {
    listAllPrompts: vi.fn((): readonly Prompt[] => [mockPrompt]),
    searchPrompts: vi.fn(() => ({
      prompts: [mockPrompt],
      page: 0,
      pageSize: 50,
      total: 1,
    })),
    getPrompt: vi.fn((id: string) => {
      if (id === mockPrompt.id) return mockPrompt;
      throw new Error("not found");
    }),
    createPrompt: vi.fn(() => mockPrompt),
    updatePrompt: vi.fn(),
    addVersion: vi.fn(),
    permanentlyDeletePrompt: vi.fn(),
    softDeletePrompt: vi.fn(),
    getLibraryStats: vi.fn(() => ({
      prompts: { total: 1, active: 1, deleted: 0, byFormat: { markdown: 1 } },
      tags: { total: 0, averagePerPrompt: 0, mostUsed: [] },
      versions: { total: 1, averagePerPrompt: 1 },
      activity: { createdThisWeek: 1, updatedThisWeek: 1, deletedThisWeek: 0 },
    })),
    getDeletedPrompts: vi.fn((): readonly Prompt[] => []),
  } as any;

  beforeEach(async () => {
    vi.clearAllMocks();
    serviceStub.listAllPrompts.mockReturnValue([mockPrompt]);
    serviceStub.searchPrompts.mockReturnValue({
      prompts: [mockPrompt],
      page: 0,
      pageSize: 50,
      total: 1,
    });
    serviceStub.getPrompt.mockImplementation((id: string) => {
      if (id === mockPrompt.id) return mockPrompt;
      throw new Error("not found");
    });
    serviceStub.createPrompt.mockReturnValue(mockPrompt);
    serviceStub.updatePrompt.mockImplementation(() => undefined);
    serviceStub.addVersion.mockImplementation(() => undefined);
    serviceStub.permanentlyDeletePrompt.mockImplementation(() => undefined);
    serviceStub.softDeletePrompt.mockImplementation(() => undefined);
    serviceStub.getDeletedPrompts.mockReturnValue([]);
    process.env.PROMPT_VAULT_TAG_DB_PATH = ":memory:";
    await resetCoreDb();
    promptService.setPromptVaultServiceForTests(serviceStub as any);
  });

  it("lists prompts with optional text filter", async () => {
    const all = await promptService.listPrompts();
    expect(all).toHaveLength(1);
    expect(serviceStub.searchPrompts).toHaveBeenCalled();

    const filtered = await promptService.listPrompts({ query: "hello" });
    expect(filtered).toHaveLength(1);
    expect(serviceStub.searchPrompts).toHaveBeenCalled();
  });

  it("filters prompts by project slug via the app-local project tag", async () => {
    const project = await createProjectTag({
      slug: "demo-project",
      label: "Demo",
    });

    await promptService.listPrompts({ projectSlug: "demo-project" });

    expect(serviceStub.searchPrompts).toHaveBeenCalledWith(
      expect.objectContaining({ projectTagId: project.id }),
    );
  });

  it("creates prompts and resolves an app-local project tag", async () => {
    const created = await promptService.createPrompt({
      title: "New Prompt",
      body: "Body content",
      projectSlug: "demo-project",
      tags: ["t1", "t2"],
    });

    const project = await getProjectTagBySlug("demo-project");
    expect(project).not.toBeNull();
    expect(serviceStub.createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: ["t1", "t2"],
        projectTagId: project?.id,
      }),
    );
    expect(created.id).toEqual(mockPrompt.id);
  });

  it("updates prompt metadata and content when provided", async () => {
    await promptService.updatePrompt("prompt-1", {
      title: "Updated Title",
      body: "Updated body",
      tags: ["t1"],
    });

    expect(serviceStub.updatePrompt).toHaveBeenCalledWith("prompt-1", {
      title: "Updated Title",
      tags: ["t1"],
    });
    expect(serviceStub.addVersion).toHaveBeenCalled();
  });

  it("deletes prompts and cleans app-local tag associations", async () => {
    const tag = await createSharedTag({ name: "cleanup" });
    await tagSharedPrompt("prompt-1", tag.id);
    expect(
      await listSharedTagsForEntity({
        entityType: "prompts",
        entityId: "prompt-1",
      }),
    ).toHaveLength(1);

    await promptService.deletePrompt("prompt-1");

    expect(
      await listSharedTagsForEntity({
        entityType: "prompts",
        entityId: "prompt-1",
      }),
    ).toHaveLength(0);
    expect(serviceStub.permanentlyDeletePrompt).toHaveBeenCalledWith("prompt-1");
  });

  it("returns null for missing prompt reads and updates", async () => {
    await expect(promptService.getPrompt("missing")).resolves.toBeNull();
    await expect(
      promptService.updatePrompt("missing", {
        title: "Unavailable",
        body: "Unavailable",
      }),
    ).resolves.toBeNull();
  });

  it("returns an empty list for an unknown project slug", async () => {
    await expect(
      promptService.listPrompts({ projectSlug: "missing-project" }),
    ).resolves.toEqual([]);
    expect(serviceStub.searchPrompts).not.toHaveBeenCalled();
  });

  it("validates direct project tags and rejects non-project and missing tags", async () => {
    const ordinaryTag = await createSharedTag({ name: "ordinary" });
    await expect(
      promptService.createPrompt({
        title: "Wrong tag",
        body: "Body",
        projectTagId: ordinaryTag.id,
      }),
    ).rejects.toThrow("is not a project tag");
    await expect(
      promptService.createPrompt({
        title: "Missing tag",
        body: "Body",
        projectTagId: "missing-tag",
      }),
    ).rejects.toThrow("Project tag not found");

    const project = await createProjectTag({
      slug: "direct-project",
      label: "Direct Project",
    });
    await promptService.createPrompt({
      title: "Direct project prompt",
      body: "Body",
      projectTagId: project.id,
    });
    expect(serviceStub.createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ projectTagId: project.id }),
    );
  });

  it("computes project-scoped stats and delegates unscoped stats", async () => {
    const project = await createProjectTag({
      slug: "stats-project",
      label: "Stats Project",
    });
    const label = await createSharedTag({ name: "Popular" });
    const now = new Date();
    const projectPrompt: Prompt = {
      ...mockPrompt,
      tags: [
        {
          id: project.id,
          label: project.name,
          createdAt: now,
        },
        {
          id: label.id,
          label: label.name,
          createdAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    const deletedPrompt: Prompt = {
      ...projectPrompt,
      id: "deleted-project-prompt",
      deletedAt: now,
    };
    serviceStub.listAllPrompts.mockReturnValue([projectPrompt]);
    serviceStub.getDeletedPrompts.mockReturnValue([deletedPrompt]);

    await expect(promptService.getLibraryStats()).resolves.toEqual(
      serviceStub.getLibraryStats(),
    );
    const scoped = await promptService.getLibraryStats({
      projectTagId: `  ${project.id}  `,
    });
    expect(scoped).toMatchObject({
      prompts: {
        total: 1,
        active: 0,
        deleted: 1,
        byFormat: { markdown: 1 },
      },
      tags: {
        total: 1,
        averagePerPrompt: 1,
        mostUsed: [{ label: "Popular", count: 1 }],
      },
      versions: { total: 1, averagePerPrompt: 1 },
      activity: {
        createdThisWeek: 1,
        updatedThisWeek: 1,
        deletedThisWeek: 1,
      },
    });
  });

  it("renders templates and exports planner drafts with missing-variable details", async () => {
    const rendered = promptService.executePromptTemplate(
      "Hello {{name}} from {{team}}",
      { name: "Ada" },
    );
    expect(rendered).toMatchObject({
      rendered: "Hello Ada from {{team}}",
      missingVariables: ["team"],
    });

    const draft = await promptService.exportPlannerDraft({ query: "hello" }, 1);
    expect(draft).toMatchObject({
      source: "prompt-vault",
      tasks: [
        {
          title: "Use: Test Prompt",
          note: "Hello world",
          tags: ["prompt-vault"],
        },
      ],
    });
  });

  it("reports partial bulk-import failures and maps Planner task defaults", async () => {
    serviceStub.createPrompt.mockImplementation(
      (input: { title: string }) => {
        if (input.title === "Broken") {
          throw new Error("write rejected");
        }
        return { ...mockPrompt, title: input.title };
      },
    );

    const imported = await promptService.importPrompts([
      { title: "Working", body: "Body", tags: ["one"] },
      { title: "Broken", body: "Body" },
    ]);
    expect(imported.created).toEqual([
      expect.objectContaining({ title: "Working" }),
    ]);
    expect(imported.failed).toEqual([
      { title: "Broken", reason: "write rejected" },
    ]);

    const planner = await promptService.importPlannerBucketDraft(
      {
        name: "Planner",
        source: "prompt-vault",
        tags: [],
        tasks: [
          { title: "  ", tags: ["task", "task"] },
          { title: "Second", note: "  ", tags: [] },
        ],
      },
      {
        projectSlug: "planner-project",
        defaultTags: ["default", " task "],
      },
    );
    expect(planner.failed).toEqual([]);
    expect(serviceStub.createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Imported task",
        body: "Imported task",
        tags: ["default", "task", "planner-aido"],
      }),
    );
    expect(serviceStub.createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Second",
        body: "Second",
        tags: ["default", "task", "planner-aido"],
      }),
    );
  });

  it("falls back to soft deletion when permanent deletion fails", async () => {
    serviceStub.permanentlyDeletePrompt.mockImplementation(() => {
      throw new Error("permanent delete unavailable");
    });

    await expect(promptService.deletePrompt("prompt-1")).resolves.toBeUndefined();

    expect(serviceStub.permanentlyDeletePrompt).toHaveBeenCalledWith("prompt-1");
    expect(serviceStub.softDeletePrompt).toHaveBeenCalledWith("prompt-1");
  });
});
