/**
 * Prompt Vault - Orchestrator Tools
 *
 * Registers tools that allow the Hub/LLM to interact with Prompt Vault.
 */

import { registerTool } from '@nw/orchestrator-sdk';
import type { ToolDefinition, ToolHandler } from '@nw/orchestrator-sdk';

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

// =============================================================================
// Tool Handlers (placeholders - connect to actual prompt-vault logic)
// =============================================================================

export const pvSearchPromptsHandler: ToolHandler = async (args) => {
    // TODO: Connect to actual prompt-vault search logic
    const { query, tags, folder, limit = 20 } = args as {
        query?: string;
        tags?: string[];
        folder?: string;
        limit?: number;
    };

    console.log('[pv_search_prompts]', { query, tags, folder, limit });

    // Placeholder - return empty array
    return [];
};

export const pvGetPromptHandler: ToolHandler = async (args) => {
    const { id } = args as { id: string };
    console.log('[pv_get_prompt]', { id });

    // Placeholder
    return null;
};

export const pvCreatePromptHandler: ToolHandler = async (args) => {
    const { title, content, tags, folder } = args as {
        title: string;
        content: string;
        tags?: string[];
        folder?: string;
    };
    console.log('[pv_create_prompt]', { title, content, tags, folder });

    // Placeholder
    return { id: 'placeholder-id', title, content, tags, folder };
};

export const pvUpdatePromptHandler: ToolHandler = async (args) => {
    const { id, title, content, tags, folder } = args as {
        id: string;
        title?: string;
        content?: string;
        tags?: string[];
        folder?: string;
    };
    console.log('[pv_update_prompt]', { id, title, content, tags, folder });

    // Placeholder
    return { id, title, content, tags, folder };
};

export const pvDeletePromptHandler: ToolHandler = async (args) => {
    const { id } = args as { id: string };
    console.log('[pv_delete_prompt]', { id });

    // Placeholder
    return true;
};

export const pvExecutePromptHandler: ToolHandler = async (args) => {
    const { id, variables } = args as { id: string; variables?: Record<string, string> };
    console.log('[pv_execute_prompt]', { id, variables });

    // Placeholder
    return 'Executed prompt content';
};

export const pvListFoldersHandler: ToolHandler = async () => {
    console.log('[pv_list_folders]');

    // Placeholder
    return [];
};

export const pvListTagsHandler: ToolHandler = async () => {
    console.log('[pv_list_tags]');

    // Placeholder
    return [];
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
];
