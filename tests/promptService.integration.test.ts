import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Prompt } from "../src/domain/models.js";
import * as promptService from "../src/lib/promptService.js";

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
    vi.clearAllMocks();
    promptService.setPromptVaultServiceForTests(serviceStub as any);
  });

  it("lists prompts with optional text filter", async () => {
    const all = await promptService.listPrompts();
    expect(all).toHaveLength(1);
    expect(serviceStub.listAllPrompts).toHaveBeenCalled();

    const filtered = await promptService.listPrompts({ query: "hello" });
    expect(filtered).toHaveLength(1);
    expect(serviceStub.searchPrompts).toHaveBeenCalled();
  });

  it("creates prompts and wires project/tag IDs via tags-projects", async () => {
    const tagsProjects = (await import("@nw/tags-projects")) as TagsProjectsModule;

    const created = await promptService.createPrompt({
      title: "New Prompt",
      body: "Body content",
      projectSlug: "demo-project",
      tagIds: ["t1", "t2"],
    });

    expect(serviceStub.createPrompt).toHaveBeenCalled();
    expect(created.id).toEqual(mockPrompt.id);

    expect(tagsProjects.getProjectTagBySlug).toHaveBeenCalledWith("demo-project");
    expect(tagsProjects.createProjectTag).toHaveBeenCalled();
    expect(tagsProjects.tagPrompt).toHaveBeenCalledWith(mockPrompt.id, "project-demo-project");

    expect(tagsProjects.tagPrompt).toHaveBeenCalledWith(mockPrompt.id, "t1");
    expect(tagsProjects.tagPrompt).toHaveBeenCalledWith(mockPrompt.id, "t2");
  });

  it("updates prompt metadata and content when provided", async () => {
    await promptService.updatePrompt("prompt-1", {
      title: "Updated Title",
      body: "Updated body",
      tagIds: ["t1"],
    });

    expect(serviceStub.updatePrompt).toHaveBeenCalledWith("prompt-1", { title: "Updated Title" });
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

