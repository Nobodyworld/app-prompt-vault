# Application Source

The `src/` tree contains the TypeScript implementation of Prompt Vault. Core domains are separated into focused modules to keep
the service maintainable and testable.

- `cli/` – Commander-based entry points for interacting with the service from the terminal.
- `config/` – Runtime configuration loaders and validation helpers.
- `db/` – SQLite database adapters and migration helpers.
- `domain/` – Entities, value objects, and validation schemas that model prompts.
- `extensions/` – Plugin framework and lifecycle hooks.
- `observability/` – Structured logging, metrics, and tracing utilities.
- `repositories/` – Data access implementations backed by SQLite.
- `services/` – Application services that orchestrate repositories, validation, and telemetry.
- `types/` – Shared TypeScript types exposed across modules.
- `web/` – API server and HTTP routing layers shared by the web UI.

When adding new modules, update this file and the top-level [`README.md`](../README.md) so contributors can quickly orient
themselves.
