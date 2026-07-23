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
- Added a standalone Node CI job configured to install pinned pnpm, generate a candidate lockfile, and run audit, lint, typecheck, build, and tests.
- Expanded the dependency-free repository audit to reject private-package imports/declarations, unsafe migration regressions, broken public links, and unpinned actions.
- Corrected public documentation, versioning, security contact, environment names, build scripts, and source-available license language.
- Removed inactivity hiding and placeholder shell controls while improving accessible labels and stable Playwright expectations.

### Intended upgrade steps

These steps are **not yet execution-validated on the current head**:

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

The last successful hosted repository audit predates the final extraction. GitHub currently fails even a no-action diagnostic job before its first step, so the current branch has no executed install, lint, typecheck, build, test, Playwright, Rust, or Tauri result. Issues #22, #23, #25, #26, and #28 remain open.

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
