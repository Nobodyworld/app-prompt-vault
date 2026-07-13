# Prompt Vault

[![Repository audit](https://github.com/Nobodyworld/app-prompt-vault/actions/workflows/repository-audit.yml/badge.svg)](https://github.com/Nobodyworld/app-prompt-vault/actions/workflows/repository-audit.yml)

Prompt Vault is a local-first application for storing, versioning, finding, and reusing prompts. It combines a React interface, a Tauri desktop shell, SQLite persistence, a CLI, an optional HTTP API, and automation/tool integrations.

> **Release status:** pre-release. PR #27 has removed the repository's private Nobodyworld workspace dependencies and parent-path assumptions, but a clean standalone installation is not yet proven because the repository still lacks a reviewed lockfile and full standalone build/test/package validation. Track the release gate in [issue #26](../../issues/26), the clean-clone work in [issue #22](../../issues/22), and the [standalone dependency matrix](docs/developer-guide/standalone-dependency-matrix.md).

## Core workflow

Prompt Vault is designed around a simple loop:

1. Create or import a prompt.
2. Organize it with categories, tags, favorites, and ratings.
3. Find it through text and metadata filters.
4. Copy it with one action.
5. Add versions without losing history.
6. Export prompts for backup or reuse in other applications.

## Current capabilities

- Prompt CRUD with SQLite persistence and migrations
- Semantic versions and version history
- Text, tag, category, and project-tag filtering
- Favorites, ratings, bulk tagging, and bulk deletion
- JSON and YAML bundle import/export
- Buttons switchboard and Planner bucket exports
- Knowledge Base reference linking
- React desktop/web interface with keyboard shortcuts and themes
- Tauri desktop commands and local telemetry controls
- CLI and Express HTTP API
- Authentication, API keys, rate limiting, audit logging, health checks, metrics, and request tracing
- App-local automation tool and widget registries

## Architecture

| Surface | Location | Responsibility |
| --- | --- | --- |
| Domain and persistence | `src/domain`, `src/db`, `src/services` | Validation, migrations, repositories, and application services |
| Platform compatibility | `src/lib/platform-core.ts` | App-owned logging, events, auth compatibility, secrets fallback, tags, and project associations |
| CLI and HTTP | `src/cli`, `src/web`, `src/server.ts` | Local automation and optional network access |
| Desktop UI | `desktop/` | React/Vite user interface |
| Native shell | `src-tauri/` | Tauri window, native SQLite commands, secrets, and telemetry |
| Automation | `src/tools`, `src/mcp` | Prompt Vault tool contracts and MCP surfaces |

Prompt content is stored in the main Prompt Vault SQLite database. Cross-cutting tag/project associations use an app-owned SQLite sidecar so the existing integration contract remains isolated from the domain database.

## Standalone development status

The source tree now declares no `workspace:*` or private `@nw/*` packages. Shared test configuration, type roots, HTTP behavior, themes, logging, events, tool registration, widget registration, auth compatibility, tags/projects, JavaScript secret fallback, and the native secrets crate are repository-owned.

The intended standalone checkout is:

```bash
corepack enable
pnpm install
pnpm repository:audit
pnpm typecheck
pnpm test
pnpm desktop:build
```

This remains an **unverified bootstrap path**, not a release claim. A repository-owned `pnpm-lock.yaml` must be generated and reviewed, followed by a successful `pnpm install --frozen-lockfile` and the full validation matrix in issue #23.

## Commands

After dependencies are installed:

```bash
pnpm repository:audit    # Dependency-free metadata and boundary audit
pnpm typecheck           # TypeScript validation
pnpm lint                # ESLint
pnpm test                # Unit and integration tests
pnpm test:coverage       # Tests with coverage
pnpm test:ui             # Playwright browser smoke tests
pnpm build               # Compile the Node/TypeScript surface
pnpm desktop:dev         # Start the React desktop UI
pnpm desktop:build       # Build static React assets
pnpm web:dev             # Start the Express API and serve built assets when present
pnpm web:build           # Build production web assets
pnpm tags:migrate-legacy # Explicit legacy tag/project sidecar migration
pnpm tauri:dev           # Start the Tauri desktop application
pnpm tauri:build         # Build native Tauri bundles
pnpm quality:gate        # Repository quality gate
```

Node 24 and pnpm 10.24.0 are required. Rust and the Tauri platform prerequisites are required for native builds.

## Configuration

Copy `.env.example` into your local environment and replace example secrets before enabling network access.

Important defaults:

- The application is local-first.
- HTTP authentication is optional unless `REQUIRE_AUTH=true`.
- Network deployments should set `REQUIRE_AUTH=true`, a strong `JWT_SECRET`, and an explicit `PROMPT_VAULT_ALLOWED_ORIGINS` list.
- `PROMPT_VAULT_TAG_DB_PATH` may override the app-owned tag/project sidecar path when embedding or diagnosing the service.
- Existing internal `*.core.db` tag/project data must be migrated into a separate target using the [legacy sidecar migration procedure](docs/developer-guide/legacy-tag-migration.md); never point the new runtime at an unreviewed legacy database.
- Prompt content and local databases are stored in plaintext; use operating-system permissions and full-disk encryption, and do not store secrets in prompts.

## Verification and release status

The lightweight repository audit workflow checks repository metadata, public links, full-SHA action pinning, and standalone source-boundary invariants. It does **not** replace the full build and packaging gate tracked in [issue #23](../../issues/23).

A public release requires all items in [issue #26](../../issues/26), including:

- reproducible clean-checkout installation;
- green Node, Playwright, Rust, and Tauri validation;
- a tested Windows artifact;
- an accurate screenshot/demo set;
- final license and security-contact review;
- manual persistence and recovery smoke testing.

## Documentation

- [Documentation index](docs/README.md)
- [Standalone dependency matrix](docs/developer-guide/standalone-dependency-matrix.md)
- [Legacy tag/project migration](docs/developer-guide/legacy-tag-migration.md)
- [Architecture overview](docs/developer-guide/architecture/overview.md)
- [Developer workflows](docs/developer-guide/workflows.md)
- [HTTP and security guide](docs/SECURITY.md)
- [Security policy](docs/security/policies/security.md)
- [Release notes](docs/releases/notes.md)
- [Changelog](CHANGELOG.md)

Historical planning and assessment files are not authoritative when they conflict with source code, this README, or open release issues.

## Security

Do not report vulnerabilities in a public issue. Follow [the security policy](docs/security/policies/security.md) and email `security@nobodyworld.com`.

## License

Copyright © 2025–2026 Nobody Production. This repository uses a proprietary source-available license. See [LICENSE](LICENSE) before copying, modifying, distributing, or deploying the software.
