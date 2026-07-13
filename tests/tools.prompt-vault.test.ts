import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let tools: typeof import("../src/tools/index.js");

beforeAll(async () => {
  tools = await import("../src/tools/index.js");
});

let promptService: {
  listPrompts: ReturnType<typeof vi.fn>;
  getPrompt: ReturnType<typeof vi.fn>;
  createPrompt: ReturnType<typeof vi.fn>;
  deletePrompt: ReturnType<typeof vi.fn>;
};

vi.mock("../src/lib/promptService.js", async () => {
  promptService = {
    listPrompts: vi.fn(async () => [
      {
        id: "p1",
        slug: "p1",
        title: "Prompt 1",
        createdAt: new Date(),
        updatedAt: new Date(),
        tags: [],
        latestVersion: {
          id: "v1",
          promptId: "p1",
          semanticVersion: "1.0.0",
          body: "Body",
          format: "markdown",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    ]),
    getPrompt: vi.fn(async (id: string) =>
      id === "p1"
        ? {
            id: "p1",
            slug: "p1",
            title: "Prompt 1",
            createdAt: new Date(),
            updatedAt: new Date(),
            tags: [],
            latestVersion: {
              id: "v1",
              promptId: "p1",
              semanticVersion: "1.0.0",
              body: "Body",
              format: "markdown",
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          }
        : null,
    ),
    createPrompt: vi.fn(async () => ({
      id: "created",
      slug: "created",
      title: "Created Prompt",
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: [],
      latestVersion: {
        id: "v1",
        promptId: "created",
        semanticVersion: "1.0.0",
        body: "Body",
        format: "markdown",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })),
    deletePrompt: vi.fn(async () => undefined),
  };

  return promptService;
});

describe("Prompt Vault tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pv_list_prompts definition is well-formed", () => {
    expect(tools.pvListPromptsDefinition.name).toBe("pv_search_prompts");
    expect(tools.pvListPromptsDefinition.description).toContain("Search prompts");
  });

  it("pv_get_prompt definition is well-formed", () => {
    expect(tools.pvGetPromptDefinition.name).toBe("pv_get_prompt");
    expect(tools.pvGetPromptDefinition.parameters).toBeDefined();
  });

  it("pv_create_prompt definition requires confirmation", () => {
    expect(tools.pvCreatePromptDefinition.name).toBe("pv_create_prompt");
    expect(tools.pvCreatePromptDefinition.requiresConfirmation).toBe(true);
  });

  it("pv_delete_prompt definition requires confirmation", () => {
    expect(tools.pvDeletePromptDefinition.name).toBe("pv_delete_prompt");
    expect(tools.pvDeletePromptDefinition.requiresConfirmation).toBe(true);
  });

  it("pv_search_prompts calls promptService.listPrompts", async () => {
    const result = await tools.pvSearchPromptsHandler(
      { query: "hello", limit: 10 },
      { projectSlug: null },
    );
    expect(result.success).toBe(true);
    expect(promptService.listPrompts).toHaveBeenCalledWith({
      query: "hello",
      tags: undefined,
    });
  });

  it("pv_get_prompt returns the prompt when found", async () => {
    const result = await tools.pvGetPromptHandler({ id: "p1" }, {});
    expect(result.success).toBe(true);
    expect(result.data).toBeTruthy();
  });

  it("pv_create_prompt prefers projectSlug from context", async () => {
    const result = await tools.pvCreatePromptHandler(
      { title: "T", content: "C" },
      { projectSlug: "ctx-project" },
    );
    expect(result.success).toBe(true);
    expect(promptService.createPrompt).toHaveBeenCalledWith({
      title: "T",
      body: "C",
      projectSlug: "ctx-project",
      tags: undefined,
    });
  });

  it("pv_delete_prompt returns NOT_FOUND when missing", async () => {
    const result = await tools.pvDeletePromptHandler({ id: "missing" }, {});
    expect(result.success).toBe(false);
    expect(result.code).toBe("NOT_FOUND");
  });

  it("pv_delete_prompt calls promptService.deletePrompt when found", async () => {
    const result = await tools.pvDeletePromptHandler({ id: "p1" }, {});
    expect(result.success).toBe(true);
    expect(promptService.deletePrompt).toHaveBeenCalledWith("p1");
  });
});
