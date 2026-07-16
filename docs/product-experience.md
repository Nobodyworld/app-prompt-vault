# Prompt Vault product experience

Prompt Vault is an independent local-first application. It may participate in a larger Nobodyworld ecosystem, but the desktop product must remain understandable and useful without a parent repository, shared shell, private package, or cross-app integration.

## Product promise

The everyday workflow is intentionally small:

1. Create or import a prompt.
2. Find it quickly.
3. Copy it with one action.
4. Edit or version it when it changes.
5. Back it up without losing local ownership.

The Library is the primary product surface. Raw interoperability payloads, bundle text, cross-app exports, and bulk administration are secondary tools and must not dominate the default view.

## Information hierarchy

### Primary

- Library
- Search
- Copy
- New prompt
- Edit prompt

### Secondary

- Optional tag and category filters
- Theme and window placement
- JSON backup import/export
- Version history

### Advanced

- JSON/YAML bundle tooling
- Buttons switchboard payloads
- Planner bucket drafts
- Bulk tagging and deletion
- Compatibility and migration utilities

Advanced tools remain available at `/advanced`, linked from Settings rather than the primary navigation.

## Shared web and desktop UI

Prompt Vault uses one React/Vite interface under `desktop/src` for both browser development and the Tauri desktop application. Rust supplies native persistence and operating-system capabilities; it does not maintain a second UI implementation.

Development modes:

- `pnpm desktop:dev` — shared frontend in a browser;
- `pnpm tauri:dev` — the same frontend in a native development WebView with hot reload;
- `pnpm desktop:preview-release` — optimized release executable without Windows installation;
- `pnpm desktop:refresh-installed` — Windows-only rebuild, MSI replacement, and launch of the refreshed installed copy.

See [Windows local desktop workflow](developer-guide/windows-local-desktop-workflow.md).

## Local data behavior

The Tauri identifier is `com.nobodyworld.promptvault`. On Windows, the current application database is stored beneath:

```text
%LOCALAPPDATA%\com.nobodyworld.promptvault\prompt-vault.db
```

Manual exact-head testing on July 15, 2026 established that uninstalling Prompt Vault 0.2.0 preserves this local database. Reinstalling the same application identifier and version reopened the preserved database and restored the recently created prompt.

An older installation used a separate identifier and database:

```text
%LOCALAPPDATA%\com.promptvault.desktop\prompt-vault.db
```

The current application did not overwrite that legacy database. Detection, migration, or explicit non-migration of the legacy identifier remains a product decision and must be handled deliberately.

The current uninstall behavior is data-preserving. Documentation must not imply that uninstall deletes prompts. A future delete-local-data flow, if added, should be explicit and separate from routine uninstall.

## Exact-head local validation record

Validated commit:

```text
91a335fd09f0611059c5edc17319bc021bc8db27
```

Validated environment:

- Node 24.12.0
- npm 11.6.2
- pnpm 10.24.0
- rustc 1.97.0
- cargo 1.97.0

Successful checks recorded locally:

- frozen pnpm installation;
- repository audit;
- ESLint;
- TypeScript typecheck;
- production Node build;
- 28 Vitest files and 130 tests;
- Playwright: 7 tests;
- Rust formatting;
- strict Clippy with warnings denied;
- Rust tests;
- Windows-target dependency proof showing `glib` absent;
- Tauri 2 MSI and NSIS bundle generation;
- manual install, launch, restart persistence, uninstall, reinstall, and data recovery.

Coverage from the exact-head run:

- statements: 45.60%;
- functions: 46.54%;
- blocks/branches: 33.78%;
- lines: 45.91%.

Coverage remains a release-quality work item rather than a completed gate.

Fresh local installer inventory from the final recorded build:

| Artifact | Size | SHA-256 |
| --- | ---: | --- |
| `Prompt Vault_0.2.0_x64_en-US.msi` | 4,612,096 bytes | `9624f37d70b173da33e9b678b2e1e8625c52a2627b1776db0534acbe96b3591a` |
| `Prompt Vault_0.2.0_x64-setup.exe` | 3,137,481 bytes | `2624a3a0f141b99acd0340672031b898ac10261beebbfdcbe4ff9f3cb28d4154` |

These unsigned local artifacts are acceptance-test evidence, not a supported release or distribution channel.

## Known follow-up work

- validate the new local release-preview and installed-refresh scripts on Windows;
- refresh the deterministic Tauri-generated schemas in a focused change;
- replace or repair the JavaScript production dependency audit that currently reaches a retired endpoint;
- decide and test legacy `com.promptvault.desktop` data migration behavior;
- add create → search → copy → edit → export Playwright coverage against the real primary workflow;
- raise coverage or approve and document a revised threshold;
- produce accurate screenshots or a short demo only after the visual cleanup is validated in the native app;
- keep PR #27 draft until the remaining release gates are complete.
