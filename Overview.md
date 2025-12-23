# Prompt Vault — Overview (Snapshot)

_Last updated: 2025-12-22._

This file is a high-signal app snapshot intended to feed the monorepo `Overview.md` apps section.

## Root Overview Snippet

<!-- nw-root-overview:start -->

- **Goal**: Prompt vault with tagging, search, and multiple surfaces (CLI, HTTP API, desktop UI), with SQLite persistence.
- **Status**:
  - Active (most complete backend in repo): SQLite migrations + repository layer; CLI + Express HTTP API exist.
  - Desktop UI exists (Vite config under `desktop/`); Tauri wrapper is available.
- **Key deps**:
  - Workspace: `@nw/core-db`, `@nw/orchestrator-sdk`, `@nw/secrets`, `@nw/ui-*` (plus other platform helpers).
  - Runtime: Express + `better-sqlite3`.
  - Testing: Vitest (plus Playwright UI tests where enabled).
- **Gap vs design**:
  - Hub/orchestrator widget + tool registration is not fully wired.
  - Keep dev/build commands consistent across surfaces (Prompt Vault has separate CLI/API/Desktop entrypoints).

<!-- nw-root-overview:end -->

## Quickstart (repo root)

- CLI: `pnpm --filter prompt-vault dev`
- Desktop UI: `pnpm --filter prompt-vault desktop:dev`
- HTTP API: `pnpm --filter prompt-vault web:dev`
- Desktop shell (Tauri): `pnpm --filter prompt-vault tauri:dev`

## Key References

- `README.md`
- `docs/SPEC.md`
- `../../docs/APPS/APP_PROMPT_VAULT.md`
- `../../TASKLISTS/REVIEWS/prompt-vault.md`
- `../../TASKLISTS/REVIEWS/prompt-vault-remediation-backlog.md`
