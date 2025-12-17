/**
 * Prompt Vault - Orchestrator Tools
 *
 * Registers tools that allow the Hub/LLM to interact with Prompt Vault.
 */

import { registerTool } from "../lib/platform-orchestrator.js";
import type {
  ToolDefinition,
  ToolHandler,
  ToolResult,
} from "../lib/platform-orchestrator.js";
import * as promptService from "../lib/promptService.js";
import type { PromptImportItem } from "../lib/promptService.js";
import type { PlannerBucketDraft } from "../domain/interop.js";
// =============================================================================
// Tool Definitions
// =============================================================================

export const pvSearchPromptsDefinition: ToolDefinition = {
  name: "pv_search_prompts",
  description:
    "Search prompts by query string, tags, or folder. Returns matching prompts with content preview.",
  parameters: [
    {
      name: "query",
      type: "string",
      description: "Search query to match against prompt title and content",
      required: false,
    },
    {
      name: "tags",
      type: "array",
      description: "Array of tag names to filter by",
      required: false,
    },
    {
      name: "folder",
      type: "string",
      description: "Folder path to search within",
      required: false,
    },
    {
      name: "limit",
      type: "number",
      description: "Maximum number of results to return (default: 20)",
      required: false,
      default: 20,
    },
  ],
  returns: {
    type: "array",
    description:
      "Array of prompt objects with id, title, preview, tags, and folder",
  },
  category: "prompts",
  source: "prompt-vault",
  ontologyEntities: ["prompt", "tag"],
};

export const pvListPromptsDefinition = pvSearchPromptsDefinition;

export const pvGetPromptDefinition: ToolDefinition = {
  name: "pv_get_prompt",
  description: "Retrieve a single prompt by ID with full content and metadata.",
  parameters: [
    {
      name: "id",
      type: "string",
      description: "The unique identifier of the prompt",
      required: true,
    },
  ],
  returns: {
    type: "object",
    description:
      "Full prompt object with id, title, content, tags, folder, variables, metadata",
  },
  category: "prompts",
  source: "prompt-vault",
  ontologyEntities: ["prompt", "tag"],
};

export const pvCreatePromptDefinition: ToolDefinition = {
  name: "pv_create_prompt",
  description:
    "Create a new prompt with title, content, and optional tags/folder.",
  parameters: [
    {
      name: "title",
      type: "string",
      description: "Title of the prompt",
      required: true,
    },
    {
      name: "content",
      type: "string",
      description: "The prompt content/template text",
      required: true,
    },
    {
      name: "tags",
      type: "array",
      description: "Array of tag names to apply",
      required: false,
    },
    {
      name: "folder",
      type: "string",
      description: "Folder path to store the prompt in",
      required: false,
    },
  ],
  returns: {
    type: "object",
    description: "The created prompt object with assigned ID",
  },
  requiresConfirmation: true,
  category: "prompts",
  source: "prompt-vault",
  ontologyEntities: ["prompt", "tag"],
};

export const pvGetStatsDefinition: ToolDefinition = {
  name: "pv_get_stats",
  description:
    "Get prompt library statistics (optionally scoped to the current Hub project).",
  parameters: [
    {
      name: "projectTagId",
      type: "string",
      description:
        "Optional project tag ID to scope stats; defaults to Hub context projectTagId when provided.",
      required: false,
    },
  ],
  returns: {
    type: "object",
    description: "Stats object with totals, activity, and top tags.",
  },
  category: "prompts",
  source: "prompt-vault",
  ontologyEntities: ["prompt", "tag"],
};

export const pvUpdatePromptDefinition: ToolDefinition = {
  name: "pv_update_prompt",
  description: "Update an existing prompt's content, title, tags, or folder.",
  parameters: [
    {
      name: "id",
      type: "string",
      description: "The unique identifier of the prompt to update",
      required: true,
    },
    {
      name: "title",
      type: "string",
      description: "New title (optional)",
      required: false,
    },
    {
      name: "content",
      type: "string",
      description: "New content (optional)",
      required: false,
    },
    {
      name: "tags",
      type: "array",
      description: "New tags array (replaces existing)",
      required: false,
    },
    {
      name: "folder",
      type: "string",
      description: "New folder path (optional)",
      required: false,
    },
  ],
  returns: {
    type: "object",
    description: "The updated prompt object",
  },
  requiresConfirmation: true,
  category: "prompts",
  source: "prompt-vault",
  ontologyEntities: ["prompt", "tag"],
};

export const pvDeletePromptDefinition: ToolDefinition = {
  name: "pv_delete_prompt",
  description: "Delete a prompt by ID.",
  parameters: [
    {
      name: "id",
      type: "string",
      description: "The unique identifier of the prompt to delete",
      required: true,
    },
  ],
  returns: {
    type: "boolean",
    description: "True if successfully deleted",
  },
  requiresConfirmation: true,
  category: "prompts",
  source: "prompt-vault",
  ontologyEntities: ["prompt", "tag"],
};

export const pvExecutePromptDefinition: ToolDefinition = {
  name: "pv_execute_prompt",
  description: "Execute a prompt template with variable substitution.",
  parameters: [
    {
      name: "id",
      type: "string",
      description: "The unique identifier of the prompt to execute",
      required: true,
    },
    {
      name: "variables",
      type: "object",
      description: "Key-value pairs for variable substitution in the template",
      required: false,
    },
  ],
  returns: {
    type: "string",
    description: "The prompt content with variables replaced",
  },
  category: "prompts",
  source: "prompt-vault",
  ontologyEntities: ["prompt"],
};

export const pvListFoldersDefinition: ToolDefinition = {
  name: "pv_list_folders",
  description: "List all prompt folders/categories.",
  parameters: [],
  returns: {
    type: "array",
    description: "Array of folder paths",
  },
  category: "prompts",
  source: "prompt-vault",
  ontologyEntities: ["prompt"],
};

export const pvListTagsDefinition: ToolDefinition = {
  name: "pv_list_tags",
  description: "List all tags with usage counts.",
  parameters: [],
  returns: {
    type: "array",
    description: "Array of {name, count} objects",
  },
  category: "prompts",
  source: "prompt-vault",
  ontologyEntities: ["tag"],
};

export const pvExportPlannerBucketDefinition: ToolDefinition = {
  name: "pv_export_planner_bucket",
  description: "Export prompts as a Planner AiDo bucket draft for import.",
  parameters: [
    {
      name: "limit",
      type: "number",
      description: "Maximum tasks to include (default: 10)",
      required: false,
      default: 10,
    },
    {
      name: "query",
      type: "string",
      description: "Optional text search",
      required: false,
    },
    {
      name: "tags",
      type: "array",
      description: "Filter by tag labels",
      required: false,
    },
    {
      name: "projectSlug",
      type: "string",
      description: "Filter by project slug (maps to shared tag)",
      required: false,
    },
  ],
  returns: {
    type: "object",
    description: "Planner bucket draft payload with tasks derived from prompts",
  },
  category: "interop",
  source: "prompt-vault",
  ontologyEntities: ["prompt", "aido", "tag"],
};

export const pvImportPromptsDefinition: ToolDefinition = {
  name: "pv_import_prompts",
  description:
    "Bulk import prompts into Prompt Vault (e.g., from Planner AiDo exports).",
  parameters: [
    {
      name: "items",
      type: "array",
      description:
        "Array of prompt objects with title, content, optional tags and projectSlug",
      required: true,
    },
  ],
  returns: {
    type: "object",
    description: "Summary of created prompts and any failures",
  },
  requiresConfirmation: true,
  category: "interop",
  source: "prompt-vault",
  ontologyEntities: ["prompt", "tag"],
};

export const pvImportPlannerBucketDefinition: ToolDefinition = {
  name: "pv_import_planner_bucket",
  description:
    "Import a Planner AiDo bucket draft into Prompt Vault as prompts.",
  parameters: [
    {
      name: "draft",
      type: "object",
      description:
        "Planner bucket draft payload (name/source/tags/tasks) to import",
      required: true,
    },
    {
      name: "projectSlug",
      type: "string",
      description:
        "Optional project slug to apply as shared project tag to imported prompts",
      required: false,
    },
    {
      name: "defaultTags",
      type: "array",
      description: "Optional tags to apply to every imported prompt",
      required: false,
    },
  ],
  returns: {
    type: "object",
    description: "Summary of created prompts and any failures",
  },
  requiresConfirmation: true,
  category: "interop",
  source: "prompt-vault",
  ontologyEntities: ["prompt", "aido", "tag"],
};

// =============================================================================
// Tool Handlers (placeholders - connect to actual prompt-vault logic)
// =============================================================================

export const pvSearchPromptsHandler: ToolHandler = async (
  args,
  ctx,
): Promise<ToolResult> => {
  const {
    query,
    tags,
    limit = 20,
    projectTagId,
  } = args as {
    query?: string;
    tags?: string[];
    limit?: number;
    projectTagId?: string;
  };

  // folder is currently ignored; preserved in definition for future filtering
  try {
    const ctxProjectTagId =
      (ctx.projectTagId as string | undefined | null) ?? undefined;
    const resolvedProjectTagId = projectTagId ?? ctxProjectTagId;
    const prompts = await promptService.listPrompts({
      query,
      tags: tags as string[] | undefined,
      projectTagId: resolvedProjectTagId,
    });
    const limited = prompts.slice(0, limit);
    return { success: true, data: limited };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
};

export const pvGetPromptHandler: ToolHandler = async (
  args,
  ctx,
): Promise<ToolResult> => {
  const { id } = args as { id: string };

  const ctxProjectTagId =
    (ctx.projectTagId as string | undefined | null) ?? undefined;

  try {
    const prompt = await promptService.getPrompt(id);
    if (!prompt) {
      return { success: false, error: "Prompt not found" };
    }

    // If Hub provides a project context, enforce that the prompt is tagged with it.
    if (ctxProjectTagId) {
      const ctxId = String(ctxProjectTagId);
      const hasProjectTag = (prompt.tags ?? []).some(
        (t) => String(t.id) === ctxId,
      );
      if (!hasProjectTag) {
        return { success: false, error: "Prompt not found" };
      }
    }

    return { success: true, data: prompt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
};

export const pvCreatePromptHandler: ToolHandler = async (
  args,
  ctx,
): Promise<ToolResult> => {
  const { title, content, tags } = args as {
    title: string;
    content: string;
    tags?: string[];
  };

  const ctxProjectTagId =
    (ctx.projectTagId as string | undefined | null) ?? undefined;
  const projectSlug =
    (ctx.projectSlug as string | undefined | null) ?? undefined;

  try {
    const created = await promptService.createPrompt({
      title,
      body: content,
      projectTagId: ctxProjectTagId,
      projectSlug,
      tags: tags as string[] | undefined,
    });
    return { success: true, data: created };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
};

export const pvGetStatsHandler: ToolHandler = async (
  args,
  ctx,
): Promise<ToolResult> => {
  const { projectTagId } = args as { projectTagId?: string };
  const ctxProjectTagId =
    (ctx.projectTagId as string | undefined | null) ?? undefined;
  const resolvedProjectTagId = projectTagId ?? ctxProjectTagId;

  try {
    const stats = await promptService.getLibraryStats({
      projectTagId: resolvedProjectTagId,
    });
    return { success: true, data: stats };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
};

export const pvUpdatePromptHandler: ToolHandler = async (
  args,
): Promise<ToolResult> => {
  const { id, title, content, tags } = args as {
    id: string;
    title?: string;
    content?: string;
    tags?: string[];
  };

  try {
    const updated = await promptService.updatePrompt(id, {
      title,
      body: content,
      tags: tags as string[] | undefined,
    });
    if (!updated) {
      return { success: false, error: "Prompt not found" };
    }
    return { success: true, data: updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
};

export const pvDeletePromptHandler: ToolHandler = async (
  args,
): Promise<ToolResult> => {
  const { id } = args as { id?: string };

  if (!id) {
    return {
      success: false,
      error: "id is required",
      code: "VALIDATION_ERROR",
    };
  }

  try {
    const existing = await promptService.getPrompt(id);
    if (!existing) {
      return { success: false, error: "Prompt not found", code: "NOT_FOUND" };
    }

    await promptService.deletePrompt(id);
    return { success: true, data: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message, code: "DELETE_FAILED" };
  }
};

export const pvExecutePromptHandler: ToolHandler = async (
  args,
): Promise<ToolResult> => {
  const { id, variables } = args as {
    id: string;
    variables?: Record<string, unknown>;
  };

  try {
    const prompt = await promptService.getPrompt(id);
    if (!prompt || !prompt.latestVersion) {
      return { success: false, error: "Prompt not found or has no content" };
    }
    const { rendered, missingVariables } = promptService.executePromptTemplate(
      prompt.latestVersion.body,
      variables ?? {},
    );
    if (missingVariables.length > 0) {
      return {
        success: false,
        error: `Missing template variables: ${missingVariables.join(", ")}`,
        data: rendered,
      };
    }
    return { success: true, data: rendered };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
};

export const pvListFoldersHandler: ToolHandler =
  async (): Promise<ToolResult> => {
    // Folder/category support is not yet integrated with the shared tags/projects system.
    return { success: true, data: [] };
  };

export const pvListTagsHandler: ToolHandler = async (): Promise<ToolResult> => {
  // Tag listing via tags-projects would be implemented in a future Tags/Projects task.
  return { success: true, data: [] };
};

export const pvExportPlannerBucketHandler: ToolHandler = async (
  args,
): Promise<ToolResult> => {
  const {
    limit = 10,
    query,
    tags,
    projectSlug,
  } = args as {
    limit?: number;
    query?: string;
    tags?: string[];
    projectSlug?: string;
  };

  try {
    const draft = await promptService.exportPlannerDraft(
      { query, tags, projectSlug },
      limit,
    );
    if (!draft) {
      return { success: false, error: "No prompts available to export" };
    }
    return { success: true, data: draft };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
};

export const pvImportPromptsHandler: ToolHandler = async (
  args,
): Promise<ToolResult> => {
  const { items } = args as { items?: PromptImportItem[] };
  if (!Array.isArray(items) || items.length === 0) {
    return { success: false, error: "items array is required" };
  }

  try {
    const result = await promptService.importPrompts(items);
    return {
      success: true,
      data: {
        created: result.created.map((prompt) => ({
          id: prompt.id,
          slug: prompt.slug,
          title: prompt.title,
        })),
        failed: result.failed,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
};

export const pvImportPlannerBucketHandler: ToolHandler = async (
  args,
  ctx,
): Promise<ToolResult> => {
  const { draft, projectSlug, defaultTags } = args as {
    draft?: unknown;
    projectSlug?: string;
    defaultTags?: string[];
  };

  if (!draft || typeof draft !== "object") {
    return { success: false, error: "draft object is required" };
  }

  type PlannerBucketDraftLike = {
    name?: string;
    source?: string;
    tags?: string[];
    tasks?: Array<{ title: string; note?: string; tags?: string[] }>;
  };

  const parsedDraft = draft as PlannerBucketDraftLike;
  if (!Array.isArray(parsedDraft.tasks) || parsedDraft.tasks.length === 0) {
    return { success: false, error: "draft.tasks array is required" };
  }

  const resolvedProjectSlug =
    projectSlug ?? (ctx.projectSlug as string | undefined | null) ?? undefined;

  try {
    const result = await promptService.importPlannerBucketDraft(
      parsedDraft as PlannerBucketDraft,
      {
        projectSlug: resolvedProjectSlug,
        defaultTags: Array.isArray(defaultTags) ? defaultTags : undefined,
      },
    );
    return {
      success: true,
      data: {
        created: result.created.map((prompt) => ({
          id: prompt.id,
          slug: prompt.slug,
          title: prompt.title,
        })),
        failed: result.failed,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
};

// =============================================================================
// Registration
// =============================================================================

/**
 * Register all Prompt Vault tools with the orchestrator
 */
export function registerPromptVaultTools(): void {
  registerTool(pvSearchPromptsDefinition, pvSearchPromptsHandler);
  registerTool(pvGetPromptDefinition, pvGetPromptHandler);
  registerTool(pvCreatePromptDefinition, pvCreatePromptHandler);
  registerTool(pvGetStatsDefinition, pvGetStatsHandler);
  registerTool(pvUpdatePromptDefinition, pvUpdatePromptHandler);
  registerTool(pvDeletePromptDefinition, pvDeletePromptHandler);
  registerTool(pvExecutePromptDefinition, pvExecutePromptHandler);
  registerTool(pvListFoldersDefinition, pvListFoldersHandler);
  registerTool(pvListTagsDefinition, pvListTagsHandler);
  registerTool(pvExportPlannerBucketDefinition, pvExportPlannerBucketHandler);
  registerTool(pvImportPromptsDefinition, pvImportPromptsHandler);
  registerTool(pvImportPlannerBucketDefinition, pvImportPlannerBucketHandler);
}

/**
 * All tool definitions for documentation/schema generation
 */
export const promptVaultToolDefinitions = [
  pvSearchPromptsDefinition,
  pvGetPromptDefinition,
  pvCreatePromptDefinition,
  pvGetStatsDefinition,
  pvUpdatePromptDefinition,
  pvDeletePromptDefinition,
  pvExecutePromptDefinition,
  pvListFoldersDefinition,
  pvListTagsDefinition,
  pvExportPlannerBucketDefinition,
  pvImportPromptsDefinition,
  pvImportPlannerBucketDefinition,
];
