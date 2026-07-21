# Prompt Vault

> ## PRE-ALPHA SOURCE PREVIEW
>
> **PROPRIETARY SOURCE-AVAILABLE**
>
> **STANDALONE BUILD LOCALLY VALIDATED; RELEASE NOT APPROVED**
>
> Prompt Vault is an experimental local-first desktop application. Public access permits source inspection and limited evaluation under [LICENSE](LICENSE); it does not grant an open-source license or establish production, migration, signing, or release readiness.

**Release status:** pre-release. There is no supported downloadable release, hosted service, or production deployment for this repository. Draft PR #27 must remain unmerged until its remaining product, migration, security, coverage, exact-head hosted-validation, and release gates are complete. Track the governing decision in [issue #26](../../issues/26).

## What Prompt Vault is

Prompt Vault is an independent app for keeping reusable prompts close at hand. It can participate in a larger Nobodyworld ecosystem, but its core workflow does not depend on a parent repository, shared UI shell, private package, or another application.

The primary loop is deliberately simple:

1. Create or import a prompt.
2. Find it by text, tag, or category.
3. Copy it with one action.
4. Edit or version it without losing history.
5. Export a backup while keeping local ownership of the data.

The Library is the product. Raw interoperability payloads, bundle text, cross-app exports, and bulk administration are advanced tools and should not dominate the default experience. See [Product experience](docs/product-experience.md).

## Current product hierarchy

### Everyday surfaces

- Library and search
- One-action copy
- New prompt
- Edit and version history
- Optional tag and category filters
- Backup import/export
- Theme and window placement

### Advanced surfaces

- JSON/YAML bundle tooling
- Buttons switchboard payloads
- Planner bucket drafts
- Bulk tagging and deletion
- Compatibility and migration utilities

Advanced tools are intentionally separated from primary navigation.

## Local data behavior

The current Tauri identifier is `com.nobodyworld.promptvault`. On Windows, the main native database is stored beneath:

```text
%LOCALAPPDATA%\com.nobodyworld.promptvault\prompt-vault.db
```

Manual testing of Prompt Vault 0.2.0 confirmed that uninstall preserves this user database. Reinstalling the same application identifier restored the recently created prompt. This data-preserving behavior protects user content, but it must remain explicitly documented.

An older installation identifier may have data at:

```text
%LOCALAPPDATA%\com.promptvault.desktop\prompt-vault.db
```

The current app uses a separate directory and did not overwrite the older database. Legacy detection or migration remains an open product decision.

Prompt content and local databases are plaintext. Use operating-system permissions and full-disk encryption, and do not store secrets in prompts.

## Exact-head local validation

Commit `91a335fd09f0611059c5edc17319bc021bc8db27` was validated locally on Windows with Node 24.12.0, pnpm 10.24.0, Rust 1.97.0, and Tauri 2.

Recorded successful checks:

- frozen dependency installation;
- repository audit, ESLint, TypeScript typecheck, and production build;
- 28 Vitest files and 130 tests;
- 7 Playwright tests;
- Rust formatting, strict Clippy, and Rust tests;
- Windows-target dependency proof showing `glib` absent;
- fresh MSI and NSIS bundle generation;
- manual install, launch, restart persistence, uninstall, reinstall, and prompt recovery.

Recorded coverage:

- statements: 45.60%;
- functions: 46.54%;
- branches/blocks: 33.78%;
- lines: 45.91%.

Coverage remains an open quality gate.

Fresh local unsigned acceptance artifacts:

| Artifact | Size | SHA-256 |
| --- | ---: | --- |
| `Prompt Vault_0.2.0_x64_en-US.msi` | 4,612,096 bytes | `9624f37d70b173da33e9b678b2e1e8625c52a2627b1776db0534acbe96b3591a` |
| `Prompt Vault_0.2.0_x64-setup.exe` | 3,137,481 bytes | `2624a3a0f141b99acd0340672031b898ac10261beebbfdcbe4ff9f3cb28d4154` |

These hashes document local acceptance evidence only. Do not distribute these unsigned files as a release.

## Architecture

| Surface | Location | Responsibility |
| --- | --- | --- |
| Domain and persistence | `src/domain`, `src/db`, `src/services` | Validation, migrations, repositories, and application services |
| Platform compatibility | `src/lib/platform-core.ts` | App-owned logging, events, auth compatibility, secrets fallback, tags, and project associations |
| CLI and HTTP | `src/cli`, `src/web`, `src/server.ts` | Local automation and optional network access |
| Desktop UI | `desktop/` | React/Vite standalone product interface |
| Native shell | `src-tauri/` | Tauri window, native SQLite commands, secrets, and telemetry |
| Automation | `src/tools`, `src/mcp` | Prompt Vault tool contracts and MCP surfaces |

## Development

Requirements:

- Node 24
- pnpm 10.24.0
- Rust and Tauri platform prerequisites for native builds

```bash
pnpm install --frozen-lockfile
pnpm repository:audit
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm test:ui
pnpm build
pnpm tauri:build
```

Useful commands:

```bash
pnpm desktop:dev               # Shared React/Vite UI in a browser
pnpm tauri:dev                 # Shared UI in a native development WebView
pnpm desktop:preview-release   # Build and launch an optimized uninstalled executable
pnpm desktop:refresh-installed # Windows: rebuild and replace the installed MSI copy
pnpm web:dev                   # Express API and built web assets
pnpm tags:migrate-legacy       # Explicit legacy tag/project migration
pnpm quality:gate              # Repository quality gate
```

See [Windows local desktop workflow](docs/developer-guide/windows-local-desktop-workflow.md) for the difference between the hot-reloading development window, release preview, and Windows-installed application.

## Remaining release work

- validate the UX cleanup in the native desktop app;
- revalidate the latest PR #43 head after documentation and package-metadata changes;
- refresh deterministic generated Tauri schemas in a focused change;
- replace or repair the JavaScript production dependency audit that reaches a retired endpoint;
- decide and prove legacy desktop-database migration behavior;
- complete primary-flow Playwright coverage;
- raise coverage or approve a documented threshold;
- reconcile exact-head hosted checks and artifact evidence;
- produce truthful screenshots or a short demo;
- complete all governing release criteria in issue #26.

## Documentation

- [Product experience](docs/product-experience.md)
- [Documentation index](docs/README.md)
- [Windows local desktop workflow](docs/developer-guide/windows-local-desktop-workflow.md)
- [Standalone dependency matrix](docs/developer-guide/standalone-dependency-matrix.md)
- [legacy sidecar migration procedure](docs/developer-guide/legacy-tag-migration.md)
- [Architecture overview](docs/developer-guide/architecture/overview.md)
- [Developer workflows](docs/developer-guide/workflows.md)
- [Security policy](docs/security/policies/security.md)
- [Release notes](docs/releases/notes.md)
- [Changelog](CHANGELOG.md)

Historical planning and assessment files are not authoritative when they conflict with source code, this README, or open release issues.

## Security

Do not disclose suspected vulnerabilities in a public issue. Follow [SECURITY.md](SECURITY.md).

## License

Copyright © 2025–2026 Nobody Production. This repository is proprietary source-available software and is **not open source**. Review [LICENSE](LICENSE) before cloning, running, copying, modifying, distributing, or otherwise using the contents.
