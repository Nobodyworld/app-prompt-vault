# Prompt Vault

[![CI](https://github.com/Nobodyworld/app-prompt-vault/actions/workflows/ci.yml/badge.svg)](https://github.com/Nobodyworld/app-prompt-vault/actions/workflows/ci.yml)

> **🎉 Successor to Prompt Rules Manager (PRM)** - This project is the next evolution of PRM with improved architecture, better performance, and enhanced features. See [Migration Guide](#migrating-from-prm) below.

## Overview

Prompt Vault is a cross-platform vault for collecting, versioning, and tagging reusable prompts. Ships CLI, HTTP API, desktop UI, and orchestrator integration with SQLite persistence.

## Purpose

- Create/store prompts with semantic versioning and history
- Tag filtering and search (full-text, metadata)
- CLI/HTTP API/desktop UI surfaces
- Optional MCP/tooling integration

## What This App Does NOT Do

- Act as a hosted multi-tenant service (local-first)
- Store secrets unrelated to prompts

## Tech Stack

- **Framework:** React/Vite (desktop/web), Tauri backend (Rust)
- **Database:** SQLite with migrations
- **UI:** `@nw/ui-kit`, `@nw/ui-layout`, `@nw/ui-theme`
- **Surfaces:** CLI, Express HTTP API, desktop UI, orchestrator tools

## Setup

```bash
pnpm install
```

## Run

```bash
pnpm dev          # web/desktop dev (see desktop/vite.config.ts for port)
pnpm tauri:dev    # desktop shell
pnpm api          # if HTTP API script exists (check package.json)
```

## Git / Branches

- This app lives in its own git repository and follows the apps-first commit workflow: app repos use branch `main` for development and commits.
- Only the designated **Git Maintainer** should execute git commands, commit, and push the root `master` after apps have been pushed. If you need a commit/push, please ask the Git Maintainer to perform it.

Prereqs: Node 24.x recommended (bindings), Rust for Tauri.

## Tests

- Unit/Integration: `pnpm test`
- E2E (if enabled): `pnpm test:e2e` (start dev server)
- Lint/Typecheck: `pnpm lint`, `pnpm typecheck`

## Dev Workflow

- Build: `pnpm build`
- Coverage: Vitest suite
- CLI/HTTP: see `src/cli` and Express server docs; keep migrations in sync

## APIs & Surfaces

- **CLI:** commander-based utilities under `src/cli`
- **HTTP API:** REST over SQLite (Express) with observability endpoints
- **Desktop UI:** React app under `desktop/`
- **Orchestrator/MCP:** Tooling hooks for automation
- **Planner AiDo import/export:** `pv_export_planner_bucket` builds a bucket draft from Vault prompts; `pv_import_prompts` bulk-imports prompt payloads (mirrors `export-planner` CLI).

## Troubleshooting

- Native bindings: use Node 24.x; `pnpm rebuild better-sqlite3` if bindings fail.
- DB migrations: run `pnpm test` to verify; check `src/db/migrations`.
- Port conflicts: adjust Vite dev port via config or CLI.

## References

- Docs index: `docs/README.md`
- Architecture/guides/ops: see `docs/architecture`, `docs/guides`, `docs/operations`, `docs/policies`, `docs/releases`, `docs/reports`

```bash
# Install dependencies
npm install

# run unit tests
npm test

# run unit tests with V8 coverage output
npm run test:coverage

# summarize collected coverage data
npm run coverage:summary

# capture repository metrics (complexity, dependency graph, latency sample)
npm run metrics:snapshot

# scaffold a plugin skeleton under src/extensions/plugins/
npm run extension:scaffold analytics

# lint the project
npm run lint

# build TypeScript output to dist/
npm run build

# run security scan with graceful offline handling
npm run security:scan

# run the full quality gate (lint → build → tests + coverage thresholds → security scan)
npm run quality:gate

# run desktop app in development
npm run desktop:dev

# build desktop app for production
npm run desktop:build

# run web app in development (with demo data)
npm run web:dev

# build and serve web app for production
npm run web:build

# run a standalone observability server (metrics + health endpoints)
npm run observability

# bootstrap a SQLite database with migrations applied
npm run db:bootstrap ./prompt-vault.db
```

## Migrating from PRM

Prompt Vault is the successor to [Prompt Rules Manager (PRM)](https://github.com/Nobodyworld/app-prompt-manager-prm), featuring improved architecture, better performance, and enhanced features.

### Key Improvements Over PRM

- **SQLite Database**: Robust, ACID-compliant storage vs filesystem-based approach
- **Better Performance**: Optimized queries and indexing for large prompt libraries
- **Enhanced Search**: Advanced full-text search with content excerpts and highlighting
- **Improved MCP**: More comprehensive Model Context Protocol integration
- **Cross-Platform**: Native desktop apps via Tauri (not just Electron)
- **Web Interface**: Browser-based UI in addition to desktop
- **Better Testing**: Higher test coverage and more comprehensive integration tests

### Migration Steps

1. **Export from PRM**:

   ```bash
   # In your PRM directory
   npm run build
   npm run cli export --all --output ./prm-export.zip
   ```

2. **Import to Prompt Vault**:

   ```bash
   # In your Prompt Vault directory
   npm install
   npm run db:bootstrap ./prompt-vault.db

   # Import individual files
   npm run dev -- import --file /path/to/prm/rules/file.md --name "My Rule"

   # Or import multiple files at once (if batch import is implemented)
   npm run dev -- import-batch --dir /path/to/prm/rules/
   ```

3. **Verify Migration**:

   ```bash
   npm run dev -- list
   npm run dev -- stats
   ```

### Feature Mapping

| PRM Feature | Prompt Vault Equivalent | Status |
| --- | --- | --- |
| Rules Library | Prompts Library | ✅ Enhanced |
| Tag Management | Tag System | ✅ Improved |
| Search & Filter | Advanced Search | ✅ Enhanced |
| Import/Export | Import/Export | ✅ Enhanced |
| Snapshots | Snapshots | ✅ Enhanced |
| VS Code Integration | VS Code Edit | ✅ Enhanced |
| MCP Server | MCP Integration | ✅ Enhanced |
| Trash/Recovery | Soft Delete/Restore | ✅ Enhanced |
| Format Conversion | Format Conversion | ✅ Enhanced |
| Desktop UI | Desktop UI | ✅ Enhanced |
| CLI Tools | CLI Tools | ✅ Enhanced |

### Data Compatibility

- **Formats**: All PRM formats (Markdown, YAML, JSON) are supported
- **Metadata**: Tags and other metadata are preserved during migration
- **File Structure**: No specific file structure requirements - import any supported files

## CLI Usage

The CLI ships with the project to help you seed and explore the vault.

```bash
# Create a prompt with tags
npm run dev -- create \
  --slug blog-outline \
  --title "Blog Outline Generator" \
  --body "You are an expert copywriter..." \
  --version 1.0.0 \
  --tags marketing,writing

# Remove tags from a prompt
npm run dev -- untag --id <prompt-id> --tags marketing

# List prompts matching a tag
npm run dev -- list --tags marketing

# Search prompts with excerpts
npm run dev -- search --text "outline" --tags marketing --page-size 5

# Add a new version
npm run dev -- version --id <prompt-id> --body "Improved prompt" --version 1.1.0

# Run doctor (integrity + migrations)
npm run dev -- doctor
```

Enable metrics/health endpoints per invocation with `PROMPT_VAULT_METRICS=true` and optionally `PROMPT_VAULT_METRICS_PORT=9464`. The CLI stores data in `prompt-vault.db` by default—pass `--db` to point to another SQLite database (e.g., `:memory:` during tests).

## HTTP API

Run `npm run web:dev` to start the combined web UI and HTTP API. The Express server exposes REST endpoints under `/api` and reuses the `PromptVaultService` so all entry points share validation, telemetry, and persistence logic.

Available endpoints:

- `GET /api/prompts` – Paginated prompt search accepting `text`, `tags`, `page`, and `pageSize` query parameters.
- `POST /api/prompts` – Create a prompt. Provide `slug`, `title`, `body`, optional `description`, optional `tags`, and `semanticVersion`.
- `GET /api/prompts/:id` – Retrieve a single prompt with its latest version and tags.
- `POST /api/prompts/:id/versions` – Append a new version by submitting `body`, `semanticVersion`, and optional `changelog`.
- `POST /api/prompts/:id/tags` – Attach one or more tags to the prompt.
- `DELETE /api/prompts/:id/tags` – Remove tag associations.

Environment configuration:

- `PORT` – HTTP port (defaults to `3001`).
- `PROMPT_VAULT_DB_PATH` – Path to the SQLite database file (defaults to `prompt-vault.db`).
- `PROMPT_VAULT_ALLOWED_ORIGINS` – Optional comma-separated origin allowlist for CORS responses. When omitted, all origins are permitted.
- `PROMPT_VAULT_METRICS=true` – Enable the observability server with health checks and metrics.
- `PROMPT_VAULT_METRICS_PORT` – Override the Prometheus/health listener port (defaults to `9464`).
- `PROMPT_VAULT_STATIC_DIR` – Path to a directory of pre-built static assets served by the HTTP API (defaults to the bundled desktop build when available).
- `PROMPT_VAULT_MIGRATIONS_DIR` – Absolute or relative path to the directory that stores SQL migrations when the default module-relative lookup does not apply (e.g., custom deployment layouts).

Operational endpoints are exposed on `/observability`:

- `GET /observability/healthz` – Liveness signal mirroring the internal health server.
- `GET /observability/readyz` – Readiness signal that flips to `503` during shutdown or startup.
- `GET /observability/metrics` – Prometheus exposition format using the in-process registry.

All HTTP responses carry an `x-request-id` header; when metrics/tracing are enabled (`PROMPT_VAULT_METRICS=true`), responses also emit `x-trace-id` and error payloads mirror `traceId` for rapid correlation in logs and telemetry exports.

> **Configuration safety:** Startup now validates ports, database paths, allowed origins, and telemetry flags. Invalid values halt the process with actionable error messages, and ambiguous combinations (e.g., metrics port without metrics enabled) surface structured warnings in the logs.

## Testing

Vitest powers the automated test suite.

```bash
# run tests once
npm test

# run in watch mode
echo "npm run test:watch"
```

Coverage reports are emitted under `coverage/` when tests run locally.

Coverage thresholds (lines/statements ≥ 85%, functions ≥ 80%, branches ≥ 75%) are enforced during `npm run quality:gate`.

## Documentation

- [`docs/architecture/overview.md`](docs/architecture/overview.md) – current runtime architecture, observability, and extension map.
- [`docs/architecture.md`](docs/architecture.md) – component relationships, data flow, and migration strategy.
- [`docs/workflows.md`](docs/workflows.md) – developer workflows, CLI recipes, and testing loops.
- [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md) – dependency inventory with security considerations.
- [`docs/guides/extension-guide.md`](docs/guides/extension-guide.md) – how to build and register plugins.
- [`docs/operations/automation.md`](docs/operations/automation.md) – guardrails and scripts for agents/automation.
- [`docs/operations/automation-roles.md`](docs/operations/automation-roles.md) – automation responsibilities and tagged entry points.
- [`docs/incident-response.md`](docs/incident-response.md) – recovery checklist and health endpoint usage.
- [`docs/performance-notes.md`](docs/performance-notes.md) – baseline metrics and tuning tips.
- [`docs/future-proofing.md`](docs/future-proofing.md) – strategic roadmap for scaling.
- [`docs/step-01-comprehend-map.md`](docs/step-01-comprehend-map.md) and related step files – Codex chain history of the build.
- [`docs/releases/notes.md`](docs/releases/notes.md) – upgrade guidance and operational notes for the latest build.
- [`docs/reports/stewards-report.md`](docs/reports/stewards-report.md) – stewardship metrics, simplifications, and forward roadmap.
- [`docs/policies/security.md`](docs/policies/security.md) – security policy, disclosure process, and hardening checklist.

### Nobodyworld OS integration docs

- `../../docs/APPS/APP_PROMPT_VAULT.md` – Nobodyworld app-level spec and UX expectations.
- `../../TASKLISTS/REVIEWS/prompt-vault.md` – gap analysis against the platform architecture.
- `../../TASKLISTS/REVIEWS/prompt-vault-remediation-backlog.md` – mapped remediation tasks and follow-ups.
- `../../docs/HUB_ORCH/ORCHESTRATOR_TOOLS_API.md` – `pv_*` tool surface exposed to the Hub orchestrator.

## Roadmap

✅ **Completed Features (vs PRM)**:

- Advanced search with content excerpts and highlighting
- Import/export functionality for external files
- Snapshots/backup system with integrity validation
- VS Code integration for deep editing
- Format conversion between Markdown ↔ YAML ↔ JSON
- Library diagnostics and integrity checks
- Library analytics and usage statistics
- Health/diagnostics endpoints for monitoring
- Enhanced plugin system with filesystem connectors
- File size limits and validation guards
- MCP integration with comprehensive JSON schemas

🔄 **Future Enhancements**:

1. Polish the UI with additional features like search and advanced filtering.
2. Introduce synchronization/export features for sharing prompt collections.
3. Automate release packaging (bundle desktop artifacts, publish changelog summaries).
4. Extend the desktop and web clients to expose the new tag removal APIs and support bulk-edit workflows.
5. Ship optional remote sync plugin for collaborative prompt libraries.

## License

This repository is distributed under a Proprietary license. All rights reserved.
