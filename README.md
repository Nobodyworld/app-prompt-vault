# Prompt Vault

[![CI](https://github.com/Nobodyworld/app-prompt-vault/actions/workflows/ci.yml/badge.svg)](https://github.com/Nobodyworld/app-prompt-vault/actions/workflows/ci.yml)
[![Codecov](https://codecov.io/gh/Nobodyworld/app-prompt-vault/branch/main/graph/badge.svg)](https://codecov.io/gh/Nobodyworld/app-prompt-vault)

> **🎉 Successor to Prompt Rules Manager (PRM)** - This project is the next evolution of PRM with improved architecture, better performance, and enhanced features. See [Migration Guide](#migrating-from-prm) below.

## CI / Codecov token

To enable authenticated uploads to Codecov (recommended for private repos or org policy), add a repository secret named `CODECOV_TOKEN` with the token from your Codecov project settings.

On GitHub:

1. Go to your repository Settings → Secrets → Actions.
2. Click "New repository secret" and add the `CODECOV_TOKEN` value.

The CI workflow will detect the presence of `CODECOV_TOKEN` and upload the generated `coverage/lcov.info` to Codecov. If the token is not provided (e.g., in forks or local runs), uploads are skipped to avoid leaking tokens.

Codecov will post PR comments with coverage diffs when uploads are received. You can further customize behavior via `codecov.yml` in the repo.

Prompt Vault is a cross-platform vault for collecting, versioning, and tagging reusable prompts. The project includes a fully typed domain layer, a CLI for quick interactions, and a React UI that works in both desktop (Tauri) and web browser environments, backed by SQLite (desktop) or a demo API server (web).

## Key Features

- **Cross-Platform** – Works in desktop (Tauri) and web browser environments with automatic feature detection.
- **Prompt Library** – Create prompts with rich metadata, semantic versioning, and change history.
- **Tag Filtering** – Attach reusable tags to group prompts by workflow, team, or modality with automatic duplicate detection.
- **SQLite Persistence** – Store data locally with migrations managed inside the repo for reproducible environments.
- **HTTP API** – Express server that exposes the domain layer over REST using the same SQLite persistence as the CLI.
- **Command-Line Interface** – Manage your library directly from the terminal with health-aware operations.
- **Desktop UI** – React-based interface for easy prompt management.
- **Test Coverage** – Vitest suite exercises core business flows and guards against regressions.
- **Observability Hooks** – Prometheus-compatible metrics, structured logging, `/observability/*` health endpoints, per-request tracing spans (`x-trace-id` headers), and a CLI doctor command for quick audits.
- **Extension Layer** – Plugins react to prompt lifecycle events without touching core service logic.
- **Advanced Search** – Full-text search with content excerpts, case sensitivity, tag/format filters, and highlighting.
- **Import/Export** – Seamless migration between Markdown, YAML, and JSON formats with external file support.
- **Snapshots & Recovery** – Point-in-time backups with restore capabilities and integrity validation.
- **MCP Integration** – Complete Model Context Protocol support for agent automation.

## Project Layout

```text
app-prompt-vault/
├─ src/
│  ├─ cli/                 # Commander-based CLI utilities
│  ├─ db/                  # SQLite connection factory and migrations
│  ├─ domain/              # Models, errors, and validation schemas
│  ├─ repositories/        # Data access layer over SQLite
│  └─ services/            # PromptVaultService façade
├─ desktop/
│  ├─ src/                 # React UI components and pages
│  ├─ index.html           # App shell
│  ├─ vite.config.ts       # Vite configuration
│  └─ tsconfig.json        # TypeScript config for UI
├─ src-tauri/              # Tauri Rust backend
├─ tests/                  # Vitest specs for service workflows
├─ docs/
│  ├─ README.md            # Directory index that links to topic-specific folders
│  ├─ architecture/        # System diagrams and design history (see architecture/README.md)
│  ├─ guides/              # Task-focused walkthroughs (see guides/README.md)
│  ├─ operations/          # Runbooks and automation guardrails (see operations/README.md)
│  ├─ policies/            # Governance and compliance policies (see policies/README.md)
│  ├─ releases/            # Release notes and upgrade guidance (see releases/README.md)
│  └─ reports/             # Stewardship updates (see reports/README.md)
├─ codex_chain.json        # Automation chain definition
├─ scripts/README.md       # Script catalogue and usage notes
├─ package.json            # Tooling, dependencies, and scripts
└─ tsconfig.json           # TypeScript compiler configuration
```

Every major directory now includes a focused `README.md` to explain its contents. Start with [`docs/README.md`](docs/README.md)
or [`src/README.md`](src/README.md) when navigating the codebase, and reference [`scripts/README.md`](scripts/README.md) for
automation entry points and [`tests/README.md`](tests/README.md) to understand the current Vitest coverage.

## Getting Started

-> **Prerequisites:** Node.js 24.x (recommended) or Node >= 18.17, Rust (for Tauri), and (optionally) SQLite libraries for native bindings.

```bash
# install dependencies
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

## Docker Deployment

Prompt Vault can be easily deployed using Docker for production environments.

### Quick Start with Docker

```bash
# Build and start the application
npm run docker:start

# Or use the deployment script
npm run docker:deploy start

# Check status
npm run docker:status

# View logs
npm run docker:logs
```

The application will be available at `http://localhost:3001`.

### Docker Commands

```bash
# Build the Docker image
npm run docker:build

# Start containers in background
npm run docker:start

# Stop containers
npm run docker:stop

# Restart containers
npm run docker:restart

# View container logs
npm run docker:logs

# Check container status
npm run docker:status

# Use the interactive deployment script
npm run docker:deploy
```

### Docker Configuration

The Docker setup includes:

- **Multi-stage build** for optimized production images
- **SQLite persistence** with named volumes for data safety
- **Health checks** for container monitoring
- **Environment configuration** for easy customization
- **Security hardening** with non-root user execution

### Environment Variables

Configure the deployment using environment variables:

```bash
# Port configuration
PROMPT_VAULT_PORT=3001

# Database configuration
PROMPT_VAULT_DB_PATH=/app/data/prompt-vault.db

# CORS configuration
PROMPT_VAULT_CORS_ORIGINS=*

# Metrics and observability
PROMPT_VAULT_METRICS=true
PROMPT_VAULT_METRICS_PORT=9090

# File size limits
PROMPT_VAULT_MAX_FILE_SIZE_BYTES=10485760
PROMPT_VAULT_MAX_PROMPT_CONTENT_LENGTH=102400
```

### Data Persistence

The Docker setup uses named volumes to persist SQLite data:

- Database files are stored in `/app/data/` inside the container
- Data survives container restarts and updates
- Use `docker volume ls` and `docker volume rm` to manage volumes

### Production Deployment

For production deployments:

1. **Customize environment variables** in `docker-compose.yml`
2. **Configure reverse proxy** (nginx, Caddy, etc.) for SSL termination
3. **Set up monitoring** using the exposed metrics endpoints
4. **Configure backups** of the named volume for data safety
5. **Use secrets management** for sensitive configuration

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
|-------------|------------------------|--------|
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

# Add a new version
npm run dev -- version --id <prompt-id> --body "Improved prompt" --version 1.1.0

# Run health checks and integrity inspection
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
