# Prompt Vault Project Snapshot (2025-11-23)

Current view of each major project/surface in the repo, its stage, next overarching phases, and compatibility notes.

## Core Service, CLI, and HTTP API (`src/`, `src/cli`, `src/web`, `src/server.ts`)
- **Stage:** Stage 3 stabilization, v0.2.0; domain + SQLite + plugins + observability are in place with quality-gate scripts.
- **Snapshot:** CLI exercises all service flows with telemetry; HTTP server has tracing/metrics and validated config loader; MCP uses the same service stack. Coverage instrumentation is still warning-only because `@vitest/coverage-v8` is unavailable.
- **Next phases:** Restore coverage provider and enforce thresholds; align default DB path with CLI (HTTP defaults to `src/prompt-vault.db`, CLI to root) or document the split; expand HTTP routes to cover backup/restore/search parity with CLI; publish nightly `metrics:snapshot` artifacts.
- **Compatibility:** High with MCP and CLI (shared service/migrations). Medium with desktop HTTP because the router returns `{ data: ... }` while the desktop client expects `{ prompts | prompt | version }` (contract mismatch). Database path divergence means CLI/HTTP hit different files unless overridden.

## Desktop React UI (`desktop/`)
- **Stage:** Beta UX; core flows (list/search filter, edit/create, copy/export helpers, theming, toasts, shortcuts) are implemented with HTTP + in-memory fallback and Tauri invoke paths.
- **Snapshot:** UX enhancements from TASKLIST are mostly done; remaining feature gaps include clipboard history, templates/wizards, diff visualisation, and fuzzy/AI search.
- **Next phases:** Align HTTP client with server response shape (`{ data }`), and share types with the service to prevent drift; add coverage/UI smoke tests for the new flows; finish open feature items (TK-20251112-008/009/020/021).
- **Compatibility:** Low with current HTTP API contract (payload shape mismatch causes runtime errors). Medium with Tauri because the Rust backend omits newer columns (category/format/soft delete), so category-aware UI fields will be dropped on save. High with in-memory fallback.

## Tauri Backend (`src-tauri/`)
- **Stage:** Prototype; supports basic CRUD + tag updates and local telemetry logging.
- **Snapshot:** Uses an embedded copy of only `001_init.sql`; schema omits category, format, and soft delete migrations; commands do not cover search/import/export/diagnostics.
- **Next phases:** Share migrations with the TypeScript service (or invoke the service directly) to eliminate schema drift; extend commands to cover search, restore, import/export, and format support; wire observability to the same telemetry/health model.
- **Compatibility:** Low with desktop UI features that rely on category/format/trash; low with CLI/HTTP data because it writes to a separate app-data DB with a different schema.

## MCP / Automation (`src/mcp/`)
- **Stage:** Stable; tools wrap the shared PromptVaultService with telemetry/plugins.
- **Snapshot:** Tools cover CRUD, search, import/export, conversions, trash, and VS Code integration.
- **Next phases:** Add contract tests against `mcp.json` schemas and CLI fixtures; version the manifest in releases; reuse coverage provider once restored.
- **Compatibility:** High with core service/CLI (shared types/migrations). Not affected by Tauri/Desktop divergences when pointed at the Node service DB.

## Ops, Packaging, and Docs (`docs/`, `scripts/`, Docker)
- **Stage:** Ops-ready; docker-compose, observability server, incident/ops playbooks, and release notes are in place.
- **Snapshot:** Metrics/health endpoints ship with the HTTP server and CLI observability script; steward report calls out missing coverage provider and suggests archiving metrics snapshots.
- **Next phases:** Integrate `metrics:snapshot` and coverage artefacts into CI; document DB path defaults across surfaces; add optional Postgres adapter exploration per roadmap; keep release notes aligned.
- **Compatibility:** High across Node-based surfaces; no direct coupling to Tauri/Desktop beyond noted DB path and schema drift.

## Compatibility Quick View
- Core ⇄ CLI ⇄ MCP: High (shared service, migrations, telemetry).
- Core/HTTP ⇄ Desktop HTTP client: Low until payload shape is aligned.
- Desktop UI ⇄ Tauri backend: Low (schema/feature gaps) and separate storage.
- CLI/HTTP ⇄ Tauri: Low (different DB locations and schemas).
- Ops/Docs: Compatible with Node surfaces; update docs once DB-path and API contract decisions are made.
