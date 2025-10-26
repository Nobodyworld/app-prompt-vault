<!--
Purpose: Short, focused guidance for AI coding agents working on this repository.
Keep instructions concise and reference concrete files/commands found in the codebase.
-->
# Copilot / AI Agent Instructions — Prompt Vault

- Repo layout (top places to look):
  - `src/services/PromptVaultService.ts` — single-entry façade for domain workflows (validation, telemetry, plugin hooks).
  - `src/repositories/PromptRepository.ts` — persistence layer using `better-sqlite3`; migrations are applied on init (`src/db/migrations/001_init.sql`).
  - `src/cli/index.ts` — CLI entry; contains `useService()` helper showing observability + DB lifecycle patterns.
  - `desktop/src/` — React UI (vite + Tauri) with pages and components that call the same domain models.
  - `src/observability/` — telemetry, structured logging, `bootstrapObservabilityFromEnv` and health/metrics helpers.

- High-level architecture summary (what an agent should assume)
  - The service layer (`PromptVaultService`) is the canonical API for business logic. Make changes there for behavior changes.
  - Repositories encapsulate SQL and transactions; prefer adding repository methods rather than sprinkling SQL elsewhere.
  - Plugins register with `PluginHost` and are executed after commits — handlers should assume the DB state is durable.

- Important runtime conventions and patterns
  - DB: `better-sqlite3` is used synchronously; repository uses `.transaction()` wrapper for atomic operations.
  - Migrations: add numbered SQL files under `src/db/migrations/` and let `PromptRepository` apply them on init.
  - Observability: use `telemetry.withSpan("service.<op>"|"repository.<op>", ...)` consistently; plugin spans follow `plugin.<name>.<event>`.
  - Tags: normalization/deduplication is enforced in `PromptVaultService.prepareTags` (trim, remove empty, lowercase uniqueness).
  - Duplicate slugs: repository maps SQLITE_CONSTRAINT_UNIQUE to `DuplicatePromptError` — changes must preserve that behavior.

- Developer workflows & commands (examples taken directly from `package.json` / CLI)
  - Install: `npm install` (Node >= 18.17 required)
  - Run CLI (dev): `npm run dev -- <command>` (examples: `create`, `list`, `tag`, `version`, `doctor`). See `src/cli/index.ts` for options.
  - Bootstrap DB: `npm run db:bootstrap ./prompt-vault.db` (runs migrations and creates DB file)
  - Run tests: `npm test` (Vitest). Coverage: `npm run test:coverage` → `coverage/` outputs.
  - Desktop dev: `npm run desktop:dev` (Vite). Build desktop: `npm run desktop:build`.
  - Observability helper: `PROMPT_VAULT_METRICS=true npm run observability` or Node env when starting the CLI to expose `/metrics` and `/healthz`.
  - Quality gate: `npm run quality:gate` (runs lint → build → tests + coverage summary → security scan).

- Editing guidance for AI changes (concrete rules)
  - Prefer changing `PromptVaultService` for business logic and `PromptRepository` for storage logic. Avoid duplicating SQL logic.
  - When adding DB schema changes, add a new `src/db/migrations/00X_description.sql` file. Keep numbering monotonic.
  - When introducing telemetry, follow existing span naming (service.* or repository.*) and attach `traceId`/correlation fields if available.
  - Plugins run after database commits: make plugin handlers idempotent and defensive (they may run in automation contexts).

- Quick code examples agents can reuse
  - Creating the service (used by the CLI):
    - `const service = new PromptVaultService(database, { telemetry, logger, plugins: [createAuditTrailPlugin()] });`
  - Running CLI commands in dev mode:
    - `npm run dev -- create --slug blog --title "..." --body "..." --version 1.0.0`

- Tests & safety
  - Unit tests are in `tests/` and use Vitest. Keep changes testable without changing global state (prefer `:memory:` DB for fast tests when possible).
  - The `doctor` command shows expected DB shape and is a useful quick integration check.

If anything above is unclear or you want additional examples (e.g., typical unit test scaffolding for service methods, or an example plugin scaffold), tell me which part to expand and I will update this file.
