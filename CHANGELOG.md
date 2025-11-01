# Changelog

All notable changes to Prompt Vault will be documented in this file.

## [Unreleased]

### Added
- Comprehensive README files for all major directories (`src/`, `desktop/`, `scripts/`, `tests/`, `src-tauri/`, `dev-tools/`, `docs/`)
- LICENSE file with proprietary license terms matching package.json
- Documentation index in `docs/README.md` covering all architectural and operational guides
- Enhanced root README with table of contents, detailed usage examples, and navigation links
- `scripts/metrics-snapshot.ts` for agent-tagged complexity, dependency, and latency reporting alongside `STEWARDS_REPORT.md` and `AUTOMATION_ROLES.md` guidance.
- Regression test asserting every SQL migration is executed and required indexes are present on new databases.
- Express observability middleware emitting Prometheus-compatible HTTP counters/histograms and an `/observability` router exposing health and metrics endpoints.
- Operational telemetry plugin that records prompt mutation events and counters for write activity.
- `npm run extension:scaffold` helper for generating plugin templates plus integration tests covering observability endpoints.
- Environment-aware server configuration loader with validation, static asset discovery, and dedicated regression tests.
- Express tracing middleware that opens `http.server.request` spans, decorates responses with `x-trace-id`, and ships dedicated tests to guard the instrumentation contract.

### Changed
- Reorganized repository structure: moved dev scripts (`insert-and-read.js`, `inspect-db.js`) to `dev-tools/` directory
- Consolidated duplicate task tracking files (removed `TASKLIST.md` in favor of `TASKSLIST.md`)
- Updated CI workflow to use Node.js 24 (matching package.json engine requirement)
- Removed redundant `node-24.yml` workflow in favor of comprehensive `ci.yml`
- Enhanced `.gitignore` with better organization, comments, and coverage of IDE files and SQLite WAL files
- Cleaned up ESLint configuration to remove redundant ignore patterns
- Updated `dev-tools/README.md` to document all available utilities
- Simplified repository transactions by delegating to `better-sqlite3`'s transaction helper and deduplicating tags before persistence.
- Express server now enforces request correlation IDs, sanitises user-provided identifiers, and returns JSON-formatted parse errors alongside the `x-request-id` header.
- HTTP error payloads now mirror both `requestId` and `traceId` so operators can stitch support cases to log streams without manual lookup.
- Migration runner executes every `.sql` file in order, enabling additive schema upgrades such as the new performance indexes for prompt search and tag operations.
- Default HTTP bootstrap enables request metrics, exposes `/observability/*` routes, and loads the operational telemetry plugin to keep metrics and logs in sync across entry points.
- HTTP API now boots with the validated configuration, logging explicit warnings for ambiguous inputs and refusing to start when required values are malformed.

### Fixed
- Tag upserts now reuse the persisted identifier returned from SQLite, preventing foreign key errors when reapplying shared labels.
- Search, tag assignment, and tag removal operations benefit from new SQLite indexes, reducing query latency on vaults with larger datasets.
- Server configuration loader now de-duplicates repeated `PROMPT_VAULT_ALLOWED_ORIGINS` entries while still surfacing warnings so CORS policies stay deterministic.

### Documentation
- Created comprehensive README files for all major directories explaining purpose, structure, and usage
- Added project structure tree with detailed annotations to root README
- Documented all npm scripts with usage examples and environment variables
- Added testing guidelines, coverage requirements, and best practices
- Created architectural documentation index linking all related guides
- Improved navigation with cross-references between related documentation

## [0.2.0] - 2025-10-26

### Added
- Observability package exposing structured logging, Prometheus-compatible metrics, and a health server with readiness controls.
- Plugin host with an audit trail reference implementation plus developer docs (`EXTENSION_GUIDE.md`, `ARCHITECTURE_OVERVIEW.md`, `AUTOMATION.md`).
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
- Release notes (`RELEASE_NOTES.md`) and expanded security guidance for operational readiness.

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

