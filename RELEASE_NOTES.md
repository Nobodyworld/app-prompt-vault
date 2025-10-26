# Prompt Vault Release Notes

## Unreleased

### Highlights
- Added `npm run metrics:snapshot` for capturing complexity, dependency, and latency metrics, with findings recorded in `STEWARDS_REPORT.md` and automation roles catalogued in `AUTOMATION_ROLES.md`.
- Simplified repository transactions to rely on atomic helpers and deduplicated tag persistence, reducing manual rollback handling.

### Upgrade Steps
1. Run `npm install` if dependencies drift (no new runtime packages were added).
2. Execute `npm run metrics:snapshot` after `npm run quality:gate` to export fresh stewardship metrics.
3. Review `STEWARDS_REPORT.md` for the latest recommendations before deployment.

### Breaking Changes
- None.

### Operational Notes
- Tag upserts now return the stored identifier from SQLite; existing databases require no migrations but agents should continue deduplicating labels before persistence.
- Coverage reporting still requires a V8 provider—expect warnings until `@vitest/coverage-v8` (or similar) is available in restricted registries.

## 0.2.0 (2025-10-26)

### Highlights
- Introduced a full observability stack (structured logger, Prometheus metrics, health server) with CLI integration and a `doctor` command.
- Added plugin host architecture with an audit trail example and new contributor docs (`ARCHITECTURE_OVERVIEW.md`, `EXTENSION_GUIDE.md`, `AUTOMATION.md`).
- Established CI/Dependabot automation, quality gate tooling, and new operational playbooks (incident response, performance, future-proofing).

### Upgrade Steps
1. Run `npm install` to capture the updated scripts (no new runtime dependencies).
2. Execute `npm run quality:gate` to lint, build, run tests with coverage enforcement, and perform the security scan.
3. Enable metrics by exporting `PROMPT_VAULT_METRICS=true` (and optionally `PROMPT_VAULT_METRICS_PORT`) before invoking the CLI or observability script.
4. Review the new documentation artifacts to align operational procedures and plugin development workflows.

### Breaking Changes
- None. APIs remain backward compatible; observability and plugins are opt-in via constructor options or environment variables.

### Operational Notes
- Busy timeouts honour `PROMPT_VAULT_BUSY_TIMEOUT`, letting operators tune contention without code changes.
- Health endpoints expose `/healthz`, `/readyz`, and `/metrics`; pair them with CI/CD or container probes for long-lived deployments.
- Reference `docs/incident-response.md`, `docs/performance-notes.md`, and `docs/future-proofing.md` for troubleshooting and scaling guidance.


## 0.1.1 (2025-10-25)

### Highlights
- Hardened SQLite connections now enforce foreign keys, use WAL journaling for writable databases, and wait up to 5 seconds before surfacing busy errors.
- Prompt workflows received additional regression coverage around pagination, tag idempotency, and timestamp updates; repository tests guard tag metadata retention.
- Added coverage workflow (`npm run test:coverage`) with summarised reporting (`npm run coverage:summary`) and a consolidated validation pipeline (`npm run validate`).
- Security guidance expanded with an explicit residual-risk register and operational checklist.

### Upgrade Steps
1. Run `npm install` to ensure local toolchain alignment (no new runtime dependencies were added).
2. Execute `npm run validate` to lint, type-check, run tests with coverage, and produce the summary report.
3. If you maintain existing SQLite databases, no schema migrations are required. The new connection defaults (foreign keys, busy timeout, WAL) are applied automatically on next launch.
4. Review the `coverage/` artifacts emitted by the validation step and archive them for CI/CD traceability.

### Breaking Changes
- None. All APIs remain backward compatible.

### Operational Notes
- Coverage data is collected using Node's V8 instrumentation (`NODE_V8_COVERAGE`). Ensure CI environments retain the generated `coverage/*.json` files for auditing. Install `@vitest/coverage-v8` (or another provider) when registry access is available so that `npm run coverage:summary` can include project source metrics.
- The desktop client remains unchanged in this iteration; roadmap items are tracked in `README.md`.
- Known risks (unencrypted local storage, manual dependency audits) are documented in `SECURITY.md`.
