# Prompt Vault — Overview

_Last updated: 2026-07-13._

Prompt Vault is a local-first prompt library with SQLite persistence, semantic version history, search/filtering, import/export, CLI, HTTP API, React UI, Tauri shell, and automation contracts.

## Current status

- **Stage:** substantial beta / pre-release.
- **Source boundary:** standalone; no private `@nw/*` or `workspace:*` package is declared.
- **Persistence:** main prompt database plus a separate app-owned tag/project sidecar.
- **Automation:** tool and widget definitions use app-local registries; external Hub adapters are optional.
- **Validation:** the last green hosted audit predates the final extraction. Current GitHub runner jobs fail before their first step, so the latest head is not runtime-validated.

## Current strengths

- Mature prompt/version repository and service layer.
- CLI and Express HTTP surfaces.
- Desktop React interface and Tauri configuration.
- Authentication, rate limiting, observability, audit events, health, and metrics.
- App-owned logging, events, API-key compatibility, tags/projects, tool registration, and widget registration.
- Explicit legacy Core DB tag/project migration path with dry-run and safety tests.

## Remaining release blockers

- Reviewed `pnpm-lock.yaml` and frozen clean install.
- Current-head lint, typecheck, build, unit/integration, coverage, and Playwright execution.
- Cargo formatting, strict Clippy, tests, and Windows Tauri packaging.
- Real legacy database migration plus restart/persistence verification.
- Showcase-first UI hierarchy, screenshots/demo, and full primary-flow E2E proof.

## Standalone commands

```bash
corepack enable
pnpm install
pnpm repository:audit
pnpm lint
pnpm typecheck
pnpm test
pnpm desktop:build
```

These commands describe the intended checkout, not a completed release proof. Issue #26 remains the governing gate.

## Key references

- [`README.md`](README.md)
- [`SPEC.md`](SPEC.md)
- [`docs/SPEC.md`](docs/SPEC.md)
- [`docs/developer-guide/standalone-dependency-matrix.md`](docs/developer-guide/standalone-dependency-matrix.md)
- [`docs/developer-guide/legacy-tag-migration.md`](docs/developer-guide/legacy-tag-migration.md)
- [Public showcase tracker](../../issues/26)
