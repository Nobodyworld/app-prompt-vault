# Prompt Vault Release Notes

## Unreleased standalone-boundary work

This section describes draft PR #27. It is not a published release and has not passed the full release gate.

### Highlights

- Removed all declared private `@nw/*`, `workspace:*`, parent configuration, parent type-root, and external native-package dependencies.
- Added app-owned implementations for logging, events, scoped environment API keys, process-local compatibility utilities, tags/projects, tool registration, and widget registration.
- Added an app-owned SQLite tag/project sidecar and explicit legacy Nobodyworld Core DB migration utility.
- Added dry-run, transactional, idempotence, schema-recognition, and main-database refusal tests for legacy migration.
- Added runtime sidecar guards that derive a new `.platform.db` from the historical Core DB path rather than opening the legacy database.
- Pinned the transitive `@hono/node-server` adapter to patched `2.0.11` after the production audit identified the Windows encoded-backslash path-traversal advisory.
- Migrated the desktop router import to `react-router` 8.3.0 after the production audit identified GHSA-qwww-vcr4-c8h2 in React Router 7.18.1.
- Added a standalone Node CI job configured to install pinned pnpm, generate a candidate lockfile, and run audit, lint, typecheck, build, and tests.
- Expanded the dependency-free repository audit to reject private-package imports/declarations, unsafe migration regressions, broken public links, and unpinned actions.
- Corrected public documentation, versioning, security contact, environment names, build scripts, and source-available license language.
- Removed inactivity hiding and placeholder shell controls while improving accessible labels and stable Playwright expectations.

### Legacy tag migration acceptance

Issue #28 acceptance was exercised on 2026-07-25 against a read-only online
backup of a qualifying historical Nobodyworld Core DB. The source and copy
passed SQLite integrity and foreign-key checks. Dry run, migration, compiled
loopback runtime, restart persistence, exact project/tag search, API-key
tag/untag, backup export, idempotence, nine malformed-copy refusals, and a
write-time transaction rollback all passed using only disposable databases.

The observed real schema matched the existing `name`-column mapping, so no
production-code extension was required. The selected copy contained one project
tag and zero taggings, and the other qualifying candidates contained no
taggings. This evidence must not be described as real historical relationship
proof. See the
[sanitized acceptance report](legacy-tag-migration-acceptance.md).

### App-tier coverage validation

The issue #47 coverage campaign exercises supported service, repository,
compatibility-facade, MCP, HTTP lifecycle, observability, plugin, Git/sync,
backup, conversion, and interoperability behavior using disposable resources.
The complete local Vitest coverage run on Windows passed 41 files and 277 tests
with the following measured coverage:

| Dimension | Covered / total | Result | App-tier target |
| --- | ---: | ---: | ---: |
| Statements | 2,844 / 3,639 | 78.15% | 60% |
| Branches | 1,448 / 2,383 | 60.76% | 50% |
| Functions | 634 / 777 | 81.59% | 55% |
| Lines | 2,770 / 3,511 | 78.89% | 60% |

All four targets pass, so Prompt Vault now uses the shared `app` coverage tier.
This is local quality-gate evidence for an unreleased child branch; it does not
establish hosted validation, public deployment support, or release readiness.

### Intended upgrade steps

These operator steps have been exercised with disposable paths on the issue #28
child branch. They are not authorization to operate on an original historical
database or either normal Prompt Vault database:

1. Back up the main Prompt Vault database and any legacy `*.core.db` file.
2. Generate and review the repository `pnpm-lock.yaml` using Node 24 and pnpm 10.24.0.
3. Run:
   ```bash
   pnpm install --frozen-lockfile
   pnpm repository:audit
   pnpm lint
   pnpm typecheck
   pnpm build
   pnpm test
   pnpm test:coverage
   pnpm test:ui
   pnpm desktop:build
   ```
4. For existing internal tag/project data, run the documented migration dry run into a separate target:
   ```bash
   pnpm tags:migrate-legacy -- \
     --source ./prompt-vault.db.core.db \
     --target ./prompt-vault-platform.db \
     --dry-run
   ```
5. Review counts, run the migration without `--dry-run`, then set:
   ```bash
   PROMPT_VAULT_TAG_DB_PATH=./prompt-vault-platform.db
   ```
6. Verify labels, project-scoped search, tag/untag, restart, persistence, and export before archiving the legacy source.
7. Run Rust/Tauri checks and manually validate the Windows artifact.

See `docs/developer-guide/legacy-tag-migration.md` for the full procedure.

### Breaking and compatibility changes

- Private Nobodyworld packages are no longer installation dependencies.
- The historical `NW_CORE_DB_PATH` is treated only as a location hint; Prompt Vault derives a separate `.platform.db` and does not open the legacy Core DB as its new sidecar.
- Direct legacy Core DB session tokens are intentionally removed as a pre-alpha breaking change. Existing callers must use a configured API key directly or exchange a valid API key for a Prompt Vault JWT; any future legacy flow requires a separately reviewed optional adapter or explicit token exchange.
- Prompt Vault JWTs, configured API keys, and the app-owned API-key compatibility store are the supported HTTP authentication paths.
- JWT issuance requires an explicitly injected `JWT_SECRET`. Without it, JWT verification returns no identity, generation fails with a controlled error, and `/auth/token` returns HTTP `503` after a valid API key is authenticated. Prompt Vault no longer generates a process-local random signing authority.
- The supported HTTP entrypoint remains loopback-only. These authentication changes do not establish production or public-network deployment readiness.
- External Hub, orchestrator, widget, event, and platform integrations now require optional adapters built against Prompt Vault's app-owned contracts.
- Existing legacy tag/project data requires the explicit migration procedure; it is not silently upgraded in place.

### Current validation limitation

The integrated parent has hosted Node, Playwright, Rust, and Windows packaging
evidence, but release approval remains blocked by the governing release issues.
The issue #28 child evidence is narrower than full historical-relationship
acceptance because bounded discovery found no qualifying source with a tagging
row. Do not merge or mark draft PR #27 ready based on this report alone.

## Earlier unreleased observability work

### Highlights

- Added Prometheus-compatible HTTP instrumentation and an `/observability` router exposing liveness, readiness, and metrics endpoints for all entry points.
- Introduced an operational telemetry plugin to count prompt mutations and mirror lifecycle events into structured logs.
- Added `pnpm extension:scaffold` to generate plugin templates alongside updated docs for agents and maintainers.
- Extended the Vitest suite with observability integration tests to guard metrics and health regressions.
- Hardened HTTP bootstrap with a validated configuration loader, explicit logging of startup warnings, and regression tests for environment parsing.
- Normalised duplicate entries in `PROMPT_VAULT_ALLOWED_ORIGINS` to keep CORS filters tight while preserving warning signals for operators.
- Instrumented HTTP requests with `http.server.request` spans and `x-trace-id` response headers.
- Reorganised documentation into topic-based directories and added directory-level navigation files.
- Improved `scripts/metrics-snapshot.ts` to close SQLite handles safely and surface actionable errors.

### Operational notes

- HTTP metrics include request duration histograms and counters for prompt write activity.
- The operational telemetry plugin records lifecycle events; replace it with an equivalent handler before disabling it.
- Every API response returns an `x-request-id`; tracing-enabled responses also expose `traceId` and `x-trace-id`.

## 0.2.0 (2025-10-26)

### Highlights

- Introduced structured logging, Prometheus metrics, a health server, CLI integration, and a doctor command.
- Added plugin host architecture with an audit trail example and contributor documentation.
- Established CI/Dependabot automation, quality-gate tooling, and operational playbooks.

### Upgrade steps

1. Install the declared dependencies with the package manager supported by that release.
2. Execute the release validation command.
3. Enable metrics with `PROMPT_VAULT_METRICS=true` and optionally configure `PROMPT_VAULT_METRICS_PORT`.
4. Review the current documentation before enabling plugins or network access.

### Operational notes

- Busy timeouts honour `PROMPT_VAULT_BUSY_TIMEOUT`.
- Health endpoints expose `/healthz`, `/readyz`, and `/metrics`.

## 0.1.1 (2025-10-25)

### Highlights

- Enabled SQLite foreign keys, WAL journaling for writable databases, and a five-second busy timeout.
- Added regression coverage around pagination, tag idempotency, timestamps, and tag metadata.
- Added coverage reporting and a consolidated validation pipeline.
- Expanded the residual-risk register and operational checklist.

### Operational notes

- Prompt version creation uses a single timestamp to keep metadata consistent.
- Tag queries sort case-insensitively and reuse descriptions when labels are reapplied.
