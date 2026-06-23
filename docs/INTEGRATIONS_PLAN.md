# Integrations Plan (app-prompt-vault)

## Doc Meta

- **Tier:** 3

This document tracks how `app-prompt-vault` integrates with the Nobodyworld OS platform and `app-hub`.

## Identifiers

- Marketplace package ID: `prompt-vault`
- Orchestrator tool `source`: `prompt-vault`
- Widget `appId`: `prompt-vault`

## Entry Points

- Platform wiring: `src/lib/nw-bridge.ts` → `initializeNwIntegrations()`
- Tools: `src/tools/index.ts` → `registerPromptVaultTools()`
- Widget manifest: `manifests/widgets.json`

## Notes

- Deeper integration docs live under `docs/developer-guide/`.

## Cross-App Contracts

### Event Bus Contracts

Prompt Vault integrates with other apps via the shared event bus (`@nw/event-bus`). All events follow a consistent schema:

```typescript
interface EventContract {
  type: string;        // Event type identifier
  payload: unknown;    // Type-safe payload
  source: string;      // Source app identifier
  timestamp: Date;     // Event timestamp
}
```

**Published Events:**

- `pv:prompt_created`: Fired when a new prompt is created
- `pv:prompt_updated`: Fired when a prompt is modified
- `pv:prompt_deleted`: Fired when a prompt is deleted

**Consumed Events:**

- `marketplace:app-installed`: Triggers prompt import from installed apps
- `workflow-buttons:button-executed`: May reference prompts for execution

### Tool Payload Schemas

All Prompt Vault tools (`pv_*`) follow consistent parameter and response schemas:

**Common Parameters:**

```typescript
interface CommonToolParams {
  dbPath?: string;     // Optional database path override
  limit?: number;      // Result limit for list/search operations
  offset?: number;     // Pagination offset
}
```

**Response Format:**

```typescript
interface ToolResponse {
  success: boolean;
  data?: unknown;      // Operation result
  error?: string;      // Error message if success=false
  metadata?: {         // Optional metadata
    count?: number;
    total?: number;
    page?: number;
  };
}
```

**Tool Schemas:**

The authoritative tool definitions live in `src/tools/index.ts` via `promptVaultToolDefinitions`.
Use those definitions as the contract surface for Hub/orchestrator.
