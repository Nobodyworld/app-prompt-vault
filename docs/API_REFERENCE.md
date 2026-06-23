# API Reference (app-prompt-vault)

## Doc Meta

- **Tier:** 3

Entry-point for public integration surfaces exposed by `app-prompt-vault`.

## Where to Look

- API reference: `docs/api-reference/`
- Tools surface: `src/tools/`

## Tool Names and Payload Schemas

### Tool Naming Convention

All Prompt Vault tools follow the `pv_*` prefix convention for consistency and discoverability.

### Tool Registry

**Search & Discovery Tools:**

- `pv_search_prompts`: Search prompts by query/tags
- `pv_get_prompt`: Get a prompt by ID
- `pv_get_stats`: Library statistics (optionally scoped to Hub project)

**CRUD Tools:**

- `pv_create_prompt`: Create a new prompt (requires confirmation)
- `pv_update_prompt`: Update a prompt (requires confirmation)
- `pv_delete_prompt`: Delete a prompt (requires confirmation)

**Version Management:**

- `pv_execute_prompt`: Render a prompt template using variables

**Import/Export Tools:**

- `pv_import_prompts`: Bulk import prompts (requires confirmation)
- `pv_import_planner_bucket`: Import Planner AiDo bucket draft (requires confirmation)
- `pv_export_planner_bucket`: Export prompts as a Planner AiDo bucket draft

**Specialized Exports:**

- `pv_kb_link`: Format/extract Knowledge Base `kb_doc:<id>` references

### Common Parameter Schema

```typescript
interface CommonParams {
  dbPath?: string;        // Database path (defaults to cwd/prompt-vault.db)
  limit?: number;         // Result limit (default varies by tool)
  offset?: number;        // Pagination offset (default 0)
  format?: 'json' | 'yaml' | 'markdown';  // Output format
}
```

### Response Schema

```typescript
interface ToolResponse {
  success: boolean;
  data?: any;             // Tool-specific result data
  error?: string;         // Error message if success=false
  metadata?: {            // Optional metadata
    count?: number;       // Number of items returned
    total?: number;       // Total available items
    page?: number;        // Current page number
    hasMore?: boolean;    // Whether more results available
  };
}
```

### Tool-Specific Schemas

**pv_search:**

```typescript
params: {
  text?: string;          // Search text
  tags?: string[];        // Tag filters
  format?: string[];      // Format filters
  isFavorite?: boolean;   // Filter by favorites
  limit?: number;
  offset?: number;
}
response: {
  prompts: PromptSummary[];
  total: number;
}
```

**pv_create:**

```typescript
params: {
  slug: string;           // Unique identifier
  title: string;          // Display title
  body: string;           // Prompt content
  format?: string;        // Content format
  tags?: string[];        // Initial tags
  description?: string;   // Optional description
}
response: {
  prompt: Prompt;
}
```
