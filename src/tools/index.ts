/**
 * Prompt Vault - Orchestrator Tools
 *
 * Registers tools that allow the Hub/LLM to interact with Prompt Vault.
 */

import { registerTool } from '@nw/orchestrator-sdk';
import type { ToolDefinition, ToolHandler, ToolResult } from '@nw/orchestrator-sdk';
import * as promptService from "../lib/promptService.js";
import type { PromptImportItem } from "../lib/promptService.js";

// =============================================================================
// Tool Definitions
// =============================================================================

export const pvSearchPromptsDefinition: ToolDefinition = {
    name: 'pv_search_prompts',
    description: 'Search prompts by query string, tags, or folder. Returns matching prompts with content preview.',
    parameters: [
        {
            name: 'query',
            type: 'string',
            description: 'Search query to match against prompt title and content',
            required: false,
        },
        {
            name: 'tags',
            type: 'array',
            description: 'Array of tag names to filter by',
            required: false,
        },
        {
            name: 'folder',
            type: 'string',
            description: 'Folder path to search within',
            required: false,
        },
        {
            name: 'limit',
            type: 'number',
            description: 'Maximum number of results to return (default: 20)',
            required: false,
            default: 20,
        },
    ],
    returns: {
        type: 'array',
        description: 'Array of prompt objects with id, title, preview, tags, and folder',
    },
    category: 'prompts',
    source: 'prompt-vault',
};

export const pvListPromptsDefinition = pvSearchPromptsDefinition;

export const pvGetPromptDefinition: ToolDefinition = {
    name: 'pv_get_prompt',
    description: 'Retrieve a single prompt by ID with full content and metadata.',
    parameters: [
        {
            name: 'id',
            type: 'string',
            description: 'The unique identifier of the prompt',
            required: true,
        },
    ],
    returns: {
        type: 'object',
        description: 'Full prompt object with id, title, content, tags, folder, variables, metadata',
    },
    category: 'prompts',
    source: 'prompt-vault',
};

export const pvCreatePromptDefinition: ToolDefinition = {
    name: 'pv_create_prompt',
    description: 'Create a new prompt with title, content, and optional tags/folder.',
    parameters: [
        {
            name: 'title',
            type: 'string',
            description: 'Title of the prompt',
            required: true,
        },
        {
            name: 'content',
            type: 'string',
            description: 'The prompt content/template text',
            required: true,
        },
        {
            name: 'tags',
            type: 'array',
            description: 'Array of tag names to apply',
            required: false,
        },
        {
            name: 'folder',
            type: 'string',
            description: 'Folder path to store the prompt in',
            required: false,
        },
    ],
    returns: {
        type: 'object',
        description: 'The created prompt object with assigned ID',
    },
    requiresConfirmation: true,
    category: 'prompts',
    source: 'prompt-vault',
};

export const pvUpdatePromptDefinition: ToolDefinition = {
    name: 'pv_update_prompt',
    description: 'Update an existing prompt\'s content, title, tags, or folder.',
    parameters: [
        {
            name: 'id',
            type: 'string',
            description: 'The unique identifier of the prompt to update',
            required: true,
        },
        {
            name: 'title',
            type: 'string',
            description: 'New title (optional)',
            required: false,
        },
        {
            name: 'content',
            type: 'string',
            description: 'New content (optional)',
            required: false,
        },
        {
            name: 'tags',
            type: 'array',
            description: 'New tags array (replaces existing)',
            required: false,
        },
        {
            name: 'folder',
            type: 'string',
            description: 'New folder path (optional)',
            required: false,
        },
    ],
    returns: {
        type: 'object',
        description: 'The updated prompt object',
    },
    requiresConfirmation: true,
    category: 'prompts',
    source: 'prompt-vault',
};

export const pvDeletePromptDefinition: ToolDefinition = {
    name: 'pv_delete_prompt',
    description: 'Delete a prompt by ID.',
    parameters: [
        {
            name: 'id',
            type: 'string',
            description: 'The unique identifier of the prompt to delete',
            required: true,
        },
    ],
    returns: {
        type: 'boolean',
        description: 'True if successfully deleted',
    },
    requiresConfirmation: true,
    category: 'prompts',
    source: 'prompt-vault',
};

export const pvExecutePromptDefinition: ToolDefinition = {
    name: 'pv_execute_prompt',
    description: 'Execute a prompt template with variable substitution.',
    parameters: [
        {
            name: 'id',
            type: 'string',
            description: 'The unique identifier of the prompt to execute',
            required: true,
        },
        {
            name: 'variables',
            type: 'object',
            description: 'Key-value pairs for variable substitution in the template',
            required: false,
        },
    ],
    returns: {
        type: 'string',
        description: 'The prompt content with variables replaced',
    },
    category: 'prompts',
    source: 'prompt-vault',
};

export const pvListFoldersDefinition: ToolDefinition = {
    name: 'pv_list_folders',
    description: 'List all prompt folders/categories.',
    parameters: [],
    returns: {
        type: 'array',
        description: 'Array of folder paths',
    },
    category: 'prompts',
    source: 'prompt-vault',
};

export const pvListTagsDefinition: ToolDefinition = {
    name: 'pv_list_tags',
    description: 'List all tags with usage counts.',
    parameters: [],
    returns: {
        type: 'array',
        description: 'Array of {name, count} objects',
    },
    category: 'prompts',
    source: 'prompt-vault',
};

export const pvExportPlannerBucketDefinition: ToolDefinition = {
    name: 'pv_export_planner_bucket',
    description: 'Export prompts as a Planner AiDo bucket draft for import.',
    parameters: [
        {
            name: 'limit',
            type: 'number',
            description: 'Maximum tasks to include (default: 10)',
            required: false,
            default: 10,
        },
        {
            name: 'query',
            type: 'string',
            description: 'Optional text search',
            required: false,
        },
        {
            name: 'tags',
            type: 'array',
            description: 'Filter by tag labels',
            required: false,
        },
        {
            name: 'projectSlug',
            type: 'string',
            description: 'Filter by project slug (maps to shared tag)',
            required: false,
        },
    ],
    returns: {
        type: 'object',
        description: 'Planner bucket draft payload with tasks derived from prompts',
    },
    category: 'interop',
    source: 'prompt-vault',
};

export const pvImportPromptsDefinition: ToolDefinition = {
    name: 'pv_import_prompts',
    description: 'Bulk import prompts into Prompt Vault (e.g., from Planner AiDo exports).',
    parameters: [
        {
            name: 'items',
            type: 'array',
            description: 'Array of prompt objects with title, content, optional tags and projectSlug',
            required: true,
        },
    ],
    returns: {
        type: 'object',
        description: 'Summary of created prompts and any failures',
    },
    requiresConfirmation: true,
    category: 'interop',
    source: 'prompt-vault',
};

// =============================================================================
// Tool Handlers (placeholders - connect to actual prompt-vault logic)
// =============================================================================

export const pvSearchPromptsHandler: ToolHandler = async (args): Promise<ToolResult> => {
    const { query, tags, limit = 20 } = args as {
        query?: string;
        tags?: string[];
        limit?: number;
    };

    // folder is currently ignored; preserved in definition for future filtering
    try {
        const prompts = await promptService.listPrompts({
            query,
            tags: tags as string[] | undefined,
        });
        const limited = prompts.slice(0, limit);
        return { success: true, data: limited };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
};

export const pvGetPromptHandler: ToolHandler = async (args): Promise<ToolResult> => {
    const { id } = args as { id: string };

    try {
        const prompt = await promptService.getPrompt(id);
        if (!prompt) {
            return { success: false, error: "Prompt not found" };
        }
        return { success: true, data: prompt };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
};

export const pvCreatePromptHandler: ToolHandler = async (args, ctx): Promise<ToolResult> => {
    const { title, content, tags } = args as {
        title: string;
        content: string;
        tags?: string[];
    };

    const projectSlug = (ctx.projectSlug as string | undefined | null) ?? undefined;

    try {
        const created = await promptService.createPrompt({
            title,
            body: content,
            projectSlug,
            tags: tags as string[] | undefined,
        });
        return { success: true, data: created };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
};

export const pvUpdatePromptHandler: ToolHandler = async (args): Promise<ToolResult> => {
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

export const pvDeletePromptHandler: ToolHandler = async (args): Promise<ToolResult> => {
    const { id } = args as { id: string };

    try {
        await promptService.deletePrompt(id);
        return { success: true, data: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
};

export const pvExecutePromptHandler: ToolHandler = async (args): Promise<ToolResult> => {
    const { id, variables } = args as { id: string; variables?: Record<string, string> };
    void variables;

    try {
        const prompt = await promptService.getPrompt(id);
        if (!prompt || !prompt.latestVersion) {
            return { success: false, error: "Prompt not found or has no content" };
        }
        // Variable substitution is a future enhancement; for now return raw content.
        return { success: true, data: prompt.latestVersion.body };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
};

export const pvListFoldersHandler: ToolHandler = async (): Promise<ToolResult> => {
    // Folder/category support is not yet integrated with the shared tags/projects system.
    return { success: true, data: [] };
};

export const pvListTagsHandler: ToolHandler = async (): Promise<ToolResult> => {
    // Tag listing via tags-projects would be implemented in a future Tags/Projects task.
    return { success: true, data: [] };
};

export const pvExportPlannerBucketHandler: ToolHandler = async (args): Promise<ToolResult> => {
    const { limit = 10, query, tags, projectSlug } = args as {
        limit?: number;
        query?: string;
        tags?: string[];
        projectSlug?: string;
    };

    try {
        const draft = await promptService.exportPlannerDraft({ query, tags, projectSlug }, limit);
        if (!draft) {
            return { success: false, error: "No prompts available to export" };
        }
        return { success: true, data: draft };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
};

export const pvImportPromptsHandler: ToolHandler = async (args): Promise<ToolResult> => {
    const { items } = args as { items?: PromptImportItem[] };
    if (!Array.isArray(items) || items.length === 0) {
        return { success: false, error: "items array is required" };
    }

    try {
        const result = await promptService.importPrompts(items);
        return {
            success: true,
            data: {
                created: result.created.map((prompt) => ({ id: prompt.id, slug: prompt.slug, title: prompt.title })),
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
    registerTool(pvUpdatePromptDefinition, pvUpdatePromptHandler);
    registerTool(pvDeletePromptDefinition, pvDeletePromptHandler);
    registerTool(pvExecutePromptDefinition, pvExecutePromptHandler);
    registerTool(pvListFoldersDefinition, pvListFoldersHandler);
    registerTool(pvListTagsDefinition, pvListTagsHandler);
    registerTool(pvExportPlannerBucketDefinition, pvExportPlannerBucketHandler);
    registerTool(pvImportPromptsDefinition, pvImportPromptsHandler);
}

/**
 * All tool definitions for documentation/schema generation
 */
export const promptVaultToolDefinitions = [
    pvSearchPromptsDefinition,
    pvGetPromptDefinition,
    pvCreatePromptDefinition,
    pvUpdatePromptDefinition,
    pvDeletePromptDefinition,
    pvExecutePromptDefinition,
    pvListFoldersDefinition,
    pvListTagsDefinition,
    pvExportPlannerBucketDefinition,
    pvImportPromptsDefinition,
];
