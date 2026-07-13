# Prompt Vault Application Specification

## Status

Prompt Vault is a substantial beta / pre-release local-first application. The source graph is standalone, but release readiness still requires a reviewed lockfile, clean-install proof, current-head tests/builds, Playwright, Rust/Tauri packaging, Windows artifact validation, and legacy data migration verification.

## 1. Product purpose

Prompt Vault stores reusable prompts, preserves version history, organizes prompts by labels and projects, supports rapid search/copy/edit workflows, and exposes optional CLI, HTTP, desktop, and automation surfaces.

The primary product promise is:

> Find the right prompt quickly, copy or adapt it safely, and keep its history and organization local and recoverable.

## 2. Primary workflows

- Create, edit, soft-delete, restore, and permanently delete prompts.
- Add semantic versions without losing prior prompt bodies.
- Search by title/content and filter by tags, category, favorite state, rating, or project.
- Copy prompt content with minimal interaction.
- Import and export JSON/YAML bundles.
- Export Planner and Buttons interoperability payloads.
- Link Knowledge Base document references.
- Run local CLI and optional authenticated HTTP workflows.

## 3. Persistence model

### Main Prompt Vault database

The main SQLite database owns:

- prompts and prompt versions;
- local prompt metadata and lifecycle state;
- application migrations and indexes;
- application-specific operational data.

### Tag/project sidecar

An app-owned SQLite sidecar owns:

- tag and project-tag metadata;
- tag-to-entity relationships;
- project-scoped prompt relationships.

The sidecar is intentionally separate from the main prompt database so optional platform compatibility remains isolated. The runtime must never open a legacy Core DB or the main Prompt Vault database as the new sidecar.

Legacy Nobodyworld Core DB data is migrated explicitly using the documented dry-run and transactional command.

## 4. Application-owned platform contracts

Prompt Vault owns the minimum contracts it requires:

- structured logger and bounded recent-log feed;
- typed in-process event bus;
- scoped environment API-key compatibility;
- Prompt Vault JWT creation and verification;
- local secret fallback with production refusal;
- tool definitions, registry, lookup, and direct invocation;
- widget definitions and registry;
- tag/project persistence and associations.

External Nobodyworld or Hub adapters may consume these contracts, but private platform packages are not required to install Prompt Vault.

## 5. User interfaces

### React desktop/web interface

- library/search/copy as the primary hierarchy;
- create/edit/detail/version flows;
- filters, favorites, ratings, bulk actions, and import/export;
- keyboard-operable controls and accessible labels;
- responsive supported minimum dimensions;
- visible startup/runtime failures rather than a blank screen.

### Tauri shell

- native window controls and packaging;
- local SQLite/native commands where implemented;
- native secret encryption/decryption boundary;
- local telemetry controls.

### CLI and HTTP

- local administrative and automation commands;
- optional Express API;
- authentication, scoped API keys, rate limiting, request IDs, tracing, health, metrics, and audit events;
- local-first and localhost-safe defaults.

## 6. Automation and integrations

- `pv_*` tool definitions are authoritative in `src/tools/index.ts`.
- Widget definitions are authoritative under `src/widgets/`.
- App-local registries live under `src/lib/`.
- External adapters translate Prompt Vault contracts into Hub/orchestrator/marketplace transports.
- Integration failure must not break core local prompt workflows.
- Prompt bodies and credentials must not be emitted through logs or lifecycle events.

## 7. Security requirements

- Network deployments require explicit authentication and CORS origins.
- A production deployment must inject `JWT_SECRET`; insecure process-local secret fallback is refused unless explicitly overridden for emergency diagnostics.
- Prompt bodies, credentials, tokens, and personal data must stay out of logs, telemetry, screenshots, and fixtures.
- Main and sidecar databases are plaintext and rely on operating-system permissions and disk encryption.
- Migration commands must open legacy sources read-only, write transactionally into separate targets, and refuse the main Prompt Vault database.

## 8. Release gate

A public release requires:

- repository-owned reviewed lockfile;
- frozen clean install on the supported Node/pnpm versions;
- green audit, lint, typecheck, build, unit/integration, coverage, and Playwright checks;
- green Cargo formatting, strict Clippy, tests, and Tauri Windows packaging;
- manually tested Windows artifact;
- verified legacy tag/project migration and restart persistence;
- showcase screenshots or demo;
- primary create → search → copy → edit → export → restart smoke test.

Issue #26 is the governing release tracker.
