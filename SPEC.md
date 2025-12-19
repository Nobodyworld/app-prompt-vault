# Prompt Vault — Specification (Monorepo Stub)

Prompt Vault is a desktop-first (Windows + Tauri) app and shared domain layer for storing, organizing, searching, and versioning prompts. It is designed to run both:

- **Standalone** as its own desktop app (Prompt Vault UI + Tauri backend + local persistence).
- **Integrated** within `apps/app-hub` via shared packages (`@nw/*`), tools, and widgets.

This file exists to satisfy the standard app “root spec” convention across `apps/*`.

## Canonical spec

- Primary spec: `docs/SPEC.md`
- API spec (OpenAPI): `docs/api-reference/openapi.yaml`

## Integration surfaces

- **Tools (orchestrator):** `src/tools/` (registered via `src/lib/nw-bridge.ts`)
- **Widgets (Hub pages):** `src/widgets/` (registered via `src/lib/nw-bridge.ts`)
- **Server (optional):** `src/server.ts` for local HTTP integration/testing

