# Changelog

All notable changes to Prompt Vault will be documented in this file.

## [Unreleased]

### Added

- Backup `2.0` with deterministic full prompt-version history, production-parser
  export verification, and explicit `1.0` latest-version-only compatibility.
- A Settings recovery center with storage status, validation and preview,
  deterministic conflict policies, transactional execution, redacted evidence,
  and bounded historical-version preview and comparison.
- Read-only native Windows detection and explicit recovery for compatible
  `%LOCALAPPDATA%\com.promptvault.desktop\prompt-vault.db` sources.
- Transactional recovery adapters for native SQLite, Node/HTTP, and browser
  fallback, including injected rollback coverage for every write stage.
- Dependency-free `repository:audit` validation for public-release metadata, action pinning, versions, public links, and standalone-boundary regressions.
- A full-SHA-pinned GitHub Actions workflow that runs the repository audit and uploads its report.
- A standalone Node validation job that generates a candidate lockfile and is configured to run lint, typecheck, build, and tests once GitHub runner startup is restored.
- GitHub issues #22–#26 as the permanent public-showcase release plan and gate.
- `tauri:build` as the explicit native packaging command.
- App-local `vitest.shared.ts` coverage configuration.
- A vendored native secrets crate under `src-tauri/crates/nw-secrets`.
- App-owned logging, event-bus, tool-registry, widget-registry, API-key compatibility, tag, and project adapters.
- Persistent tag/project associations in an app-owned SQLite sidecar with `PROMPT_VAULT_TAG_DB_PATH` override support.
- `docs/developer-guide/standalone-dependency-matrix.md` documenting the resolved source boundary and remaining validation order.
- `scripts/metrics-snapshot.ts` for agent-tagged complexity, dependency, and latency reporting alongside `docs/reports/stewards-report.md` and `docs/operations/automation-roles.md` guidance.
- Regression test asserting every SQL migration is executed and required indexes are present on new databases.
- Express observability middleware emitting Prometheus-compatible HTTP counters/histograms and an `/observability` router exposing health and metrics endpoints.
- Operational telemetry plugin that records prompt mutation events and counters for write activity.
- `npm run extension:scaffold` helper for generating plugin templates plus integration tests covering observability endpoints.
- Environment-aware server configuration loader with validation, static asset discovery, and dedicated regression tests.
- Express tracing middleware that opens `http.server.request` spans, decorates responses with `x-trace-id`, and ships dedicated tests to guard the instrumentation contract.
- Directory-level README files across source, desktop, Tauri, script, test, and documentation folders to guide navigation after the restructure.
- Additional configuration regression test covering fallback behaviour when defaults supply allowed origins.
- Refactored `src/lib/promptService.ts` to be a thin wrapper around `PromptVaultService`, eliminating redundant logic and connection management.

### Changed

- Replaced the public README with an accurate pre-release statement, standalone source-boundary status, current feature inventory, and explicit release gate.
- Corrected `.env.example` so variable names match runtime configuration and the tag/project sidecar override is documented.
- Aligned package, Tauri, and Cargo versions at `0.2.0` and updated the Tauri identifier.
- Changed `web:build` to terminate after generating production assets instead of starting the development server.
- Added type checking and the repository audit to the quality gate.
- Pinned the supported package manager as pnpm 10.24.0, marked the package private, and explicitly allowed required `better-sqlite3` and `esbuild` build scripts.
- Removed every declared private `@nw/*` and `workspace:*` dependency from the app package.
- Removed parent-only TypeScript type roots and parent Vitest configuration.
- Replaced the shared HTTP wrapper with an equivalent app-local timeout-aware fetch adapter.
- Replaced the shared placeholder theme package with app-local document theme application.
- Replaced shared logging and event packages with bounded app-local implementations.
- Replaced shared orchestrator and widget registration with app-local registries and direct tests.
- Replaced Core DB authentication compatibility with app-local scoped environment API-key handling while retaining Prompt Vault JWTs.
- Replaced shared tags/projects with app-owned SQLite sidecar persistence while preserving project-scoped filtering contracts.
- Changed the Tauri secrets dependency from a parent workspace path to the vendored crate.
- Published a usable security contact and clarified proprietary source-available review terms.
- Replaced broken documentation navigation and the stale project-stage snapshot.
- Simplified the desktop shell by removing inactivity hiding and nonfunctional sidebar/profile controls.
- Consolidated documentation into topic-specific directories under `docs/` to keep the repository root focused on source, tooling, and required governance files.
- Simplified repository transactions by delegating to `better-sqlite3`'s transaction helper and deduplicating tags before persistence.
- Express server now enforces request correlation IDs, sanitises user-provided identifiers, and returns JSON-formatted parse errors alongside the `x-request-id` header.
- HTTP error payloads now mirror both `requestId` and `traceId` so operators can stitch support cases to log streams without manual lookup.
- Migration runner executes every `.sql` file in order, enabling additive schema upgrades such as the new performance indexes for prompt search and tag operations.
- Default HTTP bootstrap enables request metrics, exposes `/observability/*` routes, and loads the operational telemetry plugin to keep metrics and logs in sync across entry points.
- HTTP API now boots with the validated configuration, logging explicit warnings for ambiguous inputs and refusing to start when required values are malformed.
- Metrics snapshot tooling now guards against uncaught exceptions and guarantees SQLite handles are closed even when sampling fails.

### Fixed

- Removed the invalid `.local` security-reporting address and unresolved jurisdiction placeholder.
- Removed contradictory public claims that the current repository is already independently installable or release-ready.
- Corrected the UI Vitest coverage threshold property for the current configuration shape.
- Theme switching now updates `data-theme` and the document color scheme instead of only logging.
- Replaced tests that mocked private platform packages with tests of the app-local registries and tag/project adapter.
- Tag upserts now reuse the persisted identifier returned from SQLite, preventing foreign key errors when reapplying shared labels.
- Search, tag assignment, and tag removal operations benefit from SQLite indexes, reducing query latency on vaults with larger datasets.
- Server configuration loader now de-duplicates repeated `PROMPT_VAULT_ALLOWED_ORIGINS` entries while still surfacing warnings so CORS policies stay deterministic.

## [0.2.0] - 2025-10-26

### Added

- Observability package exposing structured logging, Prometheus-compatible metrics, and a health server with readiness controls.
- Plugin host with an audit trail reference implementation plus developer docs (`docs/guides/extension-guide.md`, `docs/architecture/overview.md`, `docs/operations/automation.md`).
- CLI doctor command, observability bootstrap script, Dependabot config, and CI workflow running the quality gate.

### Changed

- PromptVaultService and PromptRepository now emit telemetry spans, structured logs, and plugin notifications around every workflow.
- CLI operations bootstrap observability, record telemetry events, and support opt-in metrics via environment variables.
- Validation pipeline consolidated into `npm run quality:gate` with security scanning and Vitest coverage thresholds.

### Fixed

- Documented incident response, performance baselines, and future-proofing strategy to guide recovery and scaling decisions.
- Busy timeout now honours `PROMPT_VAULT_BUSY_TIMEOUT`, allowing operators to tune contention limits without code changes.

## [0.1.1] - 2025-10-25

### Added

- Coverage workflow powered by V8 instrumentation (`npm run test:coverage`) and summary script (`npm run coverage:summary`).
- Repository-level regression tests for tag metadata preservation and service tests for pagination, timestamp updates, and no-op tag handling.
- Release notes (`docs/releases/notes.md`) and expanded security guidance for operational readiness.

### Changed

- SQLite connections now enable foreign keys and busy timeouts by default while preserving WAL mode for writable databases.
- Prompt version creation uses a single timestamp to keep metadata consistent across records.
- Tag queries sort case-insensitively and reuse existing descriptions when labels are re-applied.

## [0.1.0] - 2024-04-11

### Added

- Codex automation chain definition (`codex_chain.json`).
- TypeScript project scaffolding including package scripts, tsconfig, ESLint, and Vitest configuration.
- Domain models, validation schemas, repositories, and services powering prompt management.
- Commander-based CLI for creating, listing, tagging, and versioning prompts.
- SQLite schema migrations stored alongside source code.
- Comprehensive documentation set (architecture, workflows, dependencies, policies).
- Initial Vitest suite covering prompt workflows.

### Notes

- Desktop UI work (React + Tauri) remains in planning; CLI acts as developer interface in the interim.
