# Source Directory (`src/`)

This directory contains the core TypeScript/JavaScript implementation of Prompt Vault, organized into layered modules following clean architecture principles.

## Directory Structure

```
src/
├── cli/              # Command-line interface using Commander.js
├── config/           # Configuration validation and server settings
├── db/               # Database connection factory and migrations
├── domain/           # Domain models, validation schemas (Zod), and error types
├── extensions/       # Plugin system (PluginHost, plugin implementations)
├── observability/    # Telemetry, logging, tracing, and health endpoints
├── repositories/     # Data access layer (PromptRepository with SQLite)
├── services/         # Business logic layer (PromptVaultService façade)
├── types/            # TypeScript type definitions and ambient declarations
└── web/              # HTTP API routers (Express-based REST endpoints)
```

## Key Components

### Domain Layer (`domain/`)
- **models.ts** - Core entities (Prompt, PromptVersion, Tag, etc.)
- **validation.ts** - Zod schemas for input validation
- **errors.ts** - Custom error types (DuplicatePromptError, ValidationError, etc.)

### Service Layer (`services/`)
- **PromptVaultService.ts** - Main service façade coordinating all operations
  - Handles validation, telemetry, and plugin hooks
  - Single entry point for business logic

### Repository Layer (`repositories/`)
- **PromptRepository.ts** - Database persistence using better-sqlite3
  - Applies migrations on initialization
  - Provides transactional operations
  - Maps SQLite errors to domain errors

### CLI (`cli/`)
- **index.ts** - Command-line interface entry point
  - Commands: create, list, version, tag, untag, doctor
  - Uses `useService()` helper for observability + DB lifecycle

### Web API (`web/`)
- **createPromptVaultRouter.ts** - REST API endpoints for prompts
- **createObservabilityRouter.ts** - Health and metrics endpoints

### Extensions (`extensions/`)
- **PluginHost.ts** - Plugin registration and event dispatch
- **plugins/** - Built-in plugins (audit trail, operational telemetry)

### Observability (`observability/`)
- Structured logging, OpenTelemetry-compatible tracing
- Prometheus metrics, health/readiness endpoints
- HTTP instrumentation for tracing

## Usage Patterns

### Creating the Service

```typescript
import { createDatabase } from './db/connection.js';
import { PromptVaultService } from './services/PromptVaultService.js';
import { logger, telemetry } from './observability/index.js';
import { createAuditTrailPlugin } from './extensions/plugins/auditTrailPlugin.js';

const database = createDatabase('./prompt-vault.db');
const service = new PromptVaultService(database, {
  telemetry,
  logger,
  plugins: [createAuditTrailPlugin()]
});
```

### Repository Operations

All repository methods use transactions for atomicity:

```typescript
const prompt = repository.createPrompt({
  slug: 'example',
  title: 'Example Prompt',
  body: 'Content',
  semanticVersion: '1.0.0',
  tags: ['example']
});
```

### Plugin Development

Plugins react to lifecycle events:

```typescript
export function createMyPlugin(): Plugin {
  return {
    name: 'my-plugin',
    afterCommit: async ({ event, data }) => {
      if (event === 'prompt.created') {
        // React to prompt creation
      }
    }
  };
}
```

## Design Principles

1. **Layered Architecture** - Clear separation between domain, service, repository, and presentation layers
2. **Single Responsibility** - Each module has a focused purpose
3. **Dependency Inversion** - Services depend on abstractions (interfaces), not concrete implementations
4. **Observability First** - All operations emit telemetry spans and structured logs
5. **Transaction Boundaries** - Repository operations are atomic and consistent
6. **Plugin Extensibility** - Core logic is isolated from side effects via plugin system

## Testing

Unit tests are located in the `tests/` directory at the repository root. Tests use Vitest and in-memory SQLite databases for isolation.

Run tests:
```bash
npm test
npm run test:coverage
```

## Related Documentation

- [ARCHITECTURE_OVERVIEW.md](../ARCHITECTURE_OVERVIEW.md) - High-level system architecture
- [EXTENSION_GUIDE.md](../EXTENSION_GUIDE.md) - Plugin development guide
- [docs/architecture.md](../docs/architecture.md) - Detailed component relationships
