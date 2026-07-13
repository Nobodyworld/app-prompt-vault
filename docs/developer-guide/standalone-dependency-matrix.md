# Standalone Dependency Matrix

This document records the dependency boundary for making `app-prompt-vault` reproducibly buildable outside the Nobodyworld workspace. It is authoritative for issue #22 while PR #27 remains open.

## Connector-resolved dependencies

| Previous dependency | Resolution in PR #27 |
| --- | --- |
| `../../vitest.shared` | Coverage configuration is app-local in `vitest.shared.ts`. |
| Parent `node_modules/@types` paths | Root and desktop TypeScript configs use only repository-local type roots. |
| `@nw/connectors-http` | The timeout-aware fetch adapter is implemented in `src/lib/platform-connectors.ts`. |
| `@nw/ui-theme` | Theme application is app-local and updates document theme attributes. |
| `@nw/ui-kit` | No app call site was found; the stale declaration was removed. |
| `@nw/secrets` | Prompt Vault owns the narrow process-local fallback and refuses insecure production use unless explicitly overridden. Network deployments should inject `JWT_SECRET`. |
| `../../../packages/secrets/native` | The native secrets crate is vendored under `src-tauri/crates/nw-secrets`. |
| `@nw/logging` | Prompt Vault owns the logger factory, bounded in-memory log feed, child contexts, and sinks used by this app. |
| `@nw/event-bus` | Prompt Vault owns the typed in-process event bus for its prompt, tag, and logging events. |
| `@nw/pages-widgets` | Prompt Vault owns its widget-definition registry; an external Hub can consume an exported manifest through a future adapter. |
| `@nw/orchestrator-sdk` | Prompt Vault owns its tool types, registry, lookup, reset hook, and direct invocation helper. |
| `@nw/core-db` | Environment API-key scoping and compatibility types are app-local; Prompt Vault continues to issue and verify its own JWTs. |
| `@nw/tags-projects` | Prompt Vault owns tag/project metadata and entity associations in a dedicated SQLite sidecar database using the existing adapter API. |

These boundaries are enforced by `pnpm repository:audit`. The audit rejects `workspace:*`, declared `@nw/*` dependencies, and direct private-package imports under source, desktop, and tests.

## Current source boundary

The repository now declares **no private Nobodyworld workspace packages**. The remaining clean-clone risk is operational proof, not an unresolved source dependency:

- a repository-owned lockfile is still missing;
- install, typecheck, build, test, Playwright, Cargo, and Tauri packaging have not all been executed from a fresh standalone checkout;
- the Windows artifact and persistence/restart behavior still require manual validation.

The local platform sidecar defaults to `prompt-vault-platform.db`. `PromptVaultService` assigns a database-specific sidecar path, and `PROMPT_VAULT_TAG_DB_PATH` can explicitly override it for diagnostics or embedding.

## Remaining implementation order

1. Generate and review a repository-owned `pnpm-lock.yaml` from this branch.
2. Run a frozen clean install with Node 24 and pnpm 10.24.0.
3. Correct any type, lint, unit, integration, or coverage failures revealed by the standalone install.
4. Run Playwright and production desktop asset builds.
5. Run Cargo formatting, Clippy, tests, and Tauri Windows packaging.
6. Manually verify create, search, copy, edit, export, restart, and persistence on the Windows artifact.

## Release proof

The standalone dependency work is complete only when a fresh supported checkout can run:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm repository:audit
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm test:ui
pnpm desktop:build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri:build
```

Passing inside the parent monorepo remains useful integration evidence but does not satisfy the standalone release gate.
