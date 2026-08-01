# Prompt Vault

> ## PRE-ALPHA SOURCE PREVIEW
>
> **PROPRIETARY SOURCE-AVAILABLE**
>
> **STANDALONE BUILD LOCALLY VALIDATED; RELEASE NOT APPROVED**
>
> Prompt Vault is an experimental local-first desktop application. Public access permits source inspection and limited evaluation under [LICENSE](LICENSE); it does not grant an open-source license or establish production, migration, signing, or release readiness.

**Release status:** pre-release source preview only. There is no supported
downloadable release, GitHub Release, hosted service, or production deployment
for this repository. Unsigned installers produced by validation workflows are
build evidence only and are not supported distribution artifacts. Historical
public-showcase planning was tracked in closed [issue #26](../../issues/26);
that closed milestone is not a current governing release gate.

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

- Library search, deterministic sorting, and fast filters
- One-action copy
- In-place favorites and keyboard row actions
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

## Local HTTP authentication

The optional Prompt Vault HTTP entrypoint is loopback-only. Public-network and public-internet deployment are unsupported.

Supported credentials are Prompt Vault `HS256` JWTs signed with an explicitly injected `JWT_SECRET`, configured API keys, and the app-owned API-key compatibility store. Direct legacy Nobodyworld Core DB session tokens are intentionally unsupported.

Without `JWT_SECRET`, the local server can still start and configured API keys can authenticate, but JWT verification and issuance remain disabled. A valid API key sent to `/auth/token` receives a deliberate `503`; Prompt Vault does not create a process-local random signing authority. See [HTTP security](docs/SECURITY.md) for the exact token schema, 60-second clock-skew rule, and plaintext-data limitations.

## Accepted default-branch validation

The accepted source-preview baseline is:

```text
Main:           df39c5f3ee148a6c6469b9cb3e2eb806afd77699
Workflow:       30308626325
Event / branch: push / main
Result:         all four jobs passed
```

The workflow passed Public-release invariants, Rust validation, Windows Tauri
bundle, and Standalone Node validation. Its recorded results include:

```text
Vitest:     277 / 277 across 41 files
Playwright: 9 / 9
Rust tests: 6 / 6
```

Accepted Istanbul coverage:

| Dimension | Covered / total | Result | Configured app threshold |
| --- | ---: | ---: | ---: |
| Statements | 2,843 / 3,639 | 78.12% | >= 60% |
| Branches | 1,450 / 2,383 | 60.84% | >= 50% |
| Functions | 634 / 777 | 81.59% | >= 55% |
| Lines | 2,770 / 3,511 | 78.89% | >= 60% |

These are measured results, not new required floors. In particular, 78.15% is
not a configured statements threshold.

The Windows job's unsigned MSI and NSIS installers are validation evidence
only. No supported downloadable release or GitHub Release exists, and those
artifacts must not be presented or distributed as an approved release.

The accepted legacy-migration evidence is metadata-only. A qualifying
historical source proved recognition and migration of one project tag, but no
observed qualifying historical source contained relationship/tagging rows.
This evidence must not be described as real historical relationship proof.

## Architecture

| Surface | Location | Responsibility |
| --- | --- | --- |
| Domain and persistence | `src/domain`, `src/db`, `src/services` | Validation, migrations, repositories, and application services |
| Platform compatibility | `src/lib/platform-core.ts` | App-owned logging, events, API-key compatibility, process-local compatibility utilities, tags, and project associations |
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

## Next product work

- complete focused native acceptance of the daily Library workspace at the
  supported 400×600 logical minimum using only disposable test data;
- continue improving local-data protection and clearly communicate that prompt
  text and databases remain plaintext;
- decide how the historical `com.promptvault.desktop` data location should be
  detected or migrated, including relationship-row evidence that has not yet
  been observed;
- produce truthful screenshots or a short demo only from an accepted product
  state;
- keep signing, installer distribution, and any release decision in separately
  reviewed work. The current repository remains a source preview.

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
