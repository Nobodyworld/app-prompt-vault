# Architecture (app-prompt-vault)

## Doc Meta

- **Tier:** 3

High-level architecture entrypoint for `app-prompt-vault` (Windows desktop, Tauri).

## Where to Look

- Developer guide: `docs/developer-guide/`
- Architecture docs: `docs/developer-guide/architecture/`

## Module Map

### `src/` (Shared Backend)

- `domain/`: Core business logic and data models
  - `models.ts`: Database schemas and type definitions
  - `templating.ts`: Variable interpolation engine
  - `migrations/`: Database schema migrations
- `services/`: Business logic services
  - `PromptVaultService.ts`: Main service façade
  - `SyncService.ts`: File synchronization
- `web/`: HTTP API layer
  - `createPromptVaultRouter.ts`: Express router setup
  - `auth.ts`: Authentication middleware
  - `rate-limit.ts`: Rate limiting middleware
  - `audit.ts`: Audit logging
- `tools/`: Orchestrator tool registrations
- `widgets/`: Hub widget registrations
- `observability/`: Telemetry and monitoring
- `extensions/`: Plugin system

### `desktop/src/` (Tauri Frontend)

- `components/`: React components for desktop UI
- `hooks/`: React hooks for data fetching
- `stores/`: State management (Zustand)
- `utils/`: Frontend utilities
- `types/`: TypeScript type definitions
