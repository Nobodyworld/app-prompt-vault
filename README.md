# Prompt Vault

[![Repository audit](https://github.com/Nobodyworld/app-prompt-vault/actions/workflows/repository-audit.yml/badge.svg)](https://github.com/Nobodyworld/app-prompt-vault/actions/workflows/repository-audit.yml)

Prompt Vault is a local-first application for storing, versioning, finding, and reusing prompts. It combines a React interface, a Tauri desktop shell, SQLite persistence, a CLI, an optional HTTP API, and automation/tool integrations.

> **Release status:** pre-release. The product has substantial working functionality, but a clean standalone installation is not yet proven. PR #27 has localized test configuration, type roots, HTTP behavior, theme behavior, and the native secrets crate; the remaining blocker is a defined set of shared Nobodyworld platform contracts. Track the release gate in [issue #26](../../issues/26), the clean-clone work in [issue #22](../../issues/22), and the [standalone dependency matrix](docs/developer-guide/standalone-dependency-matrix.md).

## Core workflow

Prompt Vault is designed around a simple loop:

1. Create or import a prompt.
2. Organize it with categories, tags, favorites, and ratings.
3. Find it through text and metadata filters.
4. Copy it with one action.
5. Add versions without losing history.
6. Export prompts for backup or reuse in other Nobodyworld applications.

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
- MCP/orchestrator tool registrations

## Architecture

| Surface | Location | Responsibility |
| --- | --- | --- |
| Domain and persistence | `src/domain`, `src/db`, `src/services` | Validation, migrations, repositories, and application services |
| CLI and HTTP | `src/cli`, `src/web`, `src/server.ts` | Local automation and optional network access |
| Desktop UI | `desktop/` | React/Vite user interface |
| Native shell | `src-tauri/` | Tauri window, native SQLite commands, secrets, and telemetry |
| Automation | `src/tools`, `src/mcp` | Nobodyworld and agent-facing tool contracts |

The Node service, desktop HTTP client, and native Tauri backend are being aligned around one authoritative contract and storage model before the first public release. See [issue #22](../../issues/22).

## Supported development topology

This repository is currently maintained as an application component of the Nobodyworld workspace. The parent-only Vitest configuration, type roots, HTTP wrapper, UI theme wrapper, and native secrets path have been removed. The remaining workspace requirements are explicit platform integrations listed in the [standalone dependency matrix](docs/developer-guide/standalone-dependency-matrix.md).

For the supported internal checkout:

```bash
# From the Nobodyworld workspace root
pnpm install
pnpm --filter prompt-vault repository:audit
pnpm --filter prompt-vault typecheck
pnpm --filter prompt-vault test
pnpm --filter prompt-vault desktop:build
```

A standalone clean-clone installation remains a release blocker until the remaining platform contracts are optional or independently installable and hosted CI proves the checkout.

## Commands

Run these from this repository only after its remaining workspace dependencies are available:

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
- Prompt content and local databases are stored in plaintext; use operating-system permissions and full-disk encryption, and do not store secrets in prompts.

## Verification and release status

The lightweight repository audit workflow checks repository metadata and public-release invariants. It does **not** replace the full build and packaging gate being tracked in [issue #23](../../issues/23).

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
- [Architecture overview](docs/architecture/overview.md)
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
