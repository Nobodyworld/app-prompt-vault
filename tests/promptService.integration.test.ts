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
  } as any;

  beforeEach(async () => {
    vi.clearAllMocks();
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
});
