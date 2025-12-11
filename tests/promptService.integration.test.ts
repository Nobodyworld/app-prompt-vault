import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@nw/tags-projects", () => {
  return {
    createProjectTag: vi.fn(async (input: { slug: string }) => ({
      id: `project-${input.slug}`,
      slug: input.slug,
      label: input.slug,
      color: "#fff",
    })),
    getProjectTagBySlug: vi.fn(async () => null),
    listEntitiesByTags: vi.fn(async () => [] as string[]),
    listEntitiesWithProject: vi.fn(async () => [] as string[]),
    listTagsForEntity: vi.fn(async () => [] as any[]),
    tagPrompt: vi.fn(async () => ({})),
    untagPrompt: vi.fn(async () => true),
  };
});

import type { Prompt } from "../src/domain/models.js";
import * as promptService from "../src/lib/promptService.js";

type TagsProjectsModule = typeof import("@nw/tags-projects");

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
    searchPrompts: vi.fn(() => ({ prompts: [mockPrompt], page: 0, pageSize: 50, total: 1 })),
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

  beforeEach(() => {
    // Reset mocks so per-test overrides do not leak (e.g., getProjectTagBySlug returning a cached value)
    vi.resetAllMocks();
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

  it("filters prompts by project slug via projectTagId", async () => {
    const tagsProjects = (await import("@nw/tags-projects")) as TagsProjectsModule;
    (tagsProjects.getProjectTagBySlug as unknown as vi.Mock).mockResolvedValue({
      id: "project-123",
      slug: "demo-project",
      label: "Demo",
      color: "#fff",
    });

    await promptService.listPrompts({ projectSlug: "demo-project" });

    expect(tagsProjects.getProjectTagBySlug).toHaveBeenCalledWith("demo-project");
    expect(serviceStub.searchPrompts).toHaveBeenCalledWith(expect.objectContaining({
      projectTagId: "project-123",
    }));
  });

  it("creates prompts and wires project/tag IDs via tags-projects", async () => {
    const tagsProjects = (await import("@nw/tags-projects")) as TagsProjectsModule;

    const created = await promptService.createPrompt({
      title: "New Prompt",
      body: "Body content",
      projectSlug: "demo-project",
      tags: ["t1", "t2"],
    });

    expect(serviceStub.createPrompt).toHaveBeenCalledWith(expect.objectContaining({
      tags: ["t1", "t2"]
    }));
    expect(created.id).toEqual(mockPrompt.id);

    expect(tagsProjects.getProjectTagBySlug).toHaveBeenCalledWith("demo-project");
    expect(tagsProjects.createProjectTag).toHaveBeenCalled();
    expect(tagsProjects.tagPrompt).toHaveBeenCalledWith(mockPrompt.id, "project-demo-project");
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

  it("deletes prompts and best-effort cleans taggings", async () => {
    const tagsProjects = (await import("@nw/tags-projects")) as TagsProjectsModule;

    await promptService.deletePrompt("prompt-1");

    expect(tagsProjects.listTagsForEntity).toHaveBeenCalledWith({
      entityType: "prompts",
      entityId: "prompt-1",
    });
    expect(serviceStub.permanentlyDeletePrompt).toHaveBeenCalledWith("prompt-1");
  });
});

