import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  pvListPromptsDefinition,
  pvGetPromptDefinition,
  pvCreatePromptDefinition,
} from "../src/tools/index.js";
import {
  pvSearchPromptsHandler,
  pvGetPromptHandler,
  pvCreatePromptHandler,
} from "../src/tools/index.js";
import * as promptService from "../src/lib/promptService.js";

vi.mock("../src/lib/promptService.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/promptService.js")>(
    "../src/lib/promptService.js"
  );
  return {
    ...actual,
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
        : null
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
  };
});

describe("Prompt Vault tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pv_list_prompts definition is well-formed", () => {
    expect(pvListPromptsDefinition.name).toBe("pv_search_prompts");
    expect(pvListPromptsDefinition.description).toContain("Search prompts");
  });

  it("pv_get_prompt definition is well-formed", () => {
    expect(pvGetPromptDefinition.name).toBe("pv_get_prompt");
    expect(pvGetPromptDefinition.parameters).toBeDefined();
  });

  it("pv_create_prompt definition requires confirmation", () => {
    expect(pvCreatePromptDefinition.name).toBe("pv_create_prompt");
    expect(pvCreatePromptDefinition.requiresConfirmation).toBe(true);
  });

  it("pv_search_prompts calls promptService.listPrompts", async () => {
    const result = await pvSearchPromptsHandler(
      { query: "hello", limit: 10 },
      { projectSlug: null }
    );
    expect(result.success).toBe(true);
    expect((promptService.listPrompts as any)).toHaveBeenCalledWith({
      query: "hello",
      tagIds: undefined,
    });
  });

  it("pv_get_prompt returns the prompt when found", async () => {
    const result = await pvGetPromptHandler({ id: "p1" }, {});
    expect(result.success).toBe(true);
    expect(result.data).toBeTruthy();
  });

  it("pv_create_prompt prefers projectSlug from context", async () => {
    const result = await pvCreatePromptHandler(
      { title: "T", content: "C" },
      { projectSlug: "ctx-project" }
    );
    expect(result.success).toBe(true);
    expect((promptService.createPrompt as any)).toHaveBeenCalledWith({
      title: "T",
      body: "C",
      projectSlug: "ctx-project",
      tagIds: undefined,
    });
  });
});

