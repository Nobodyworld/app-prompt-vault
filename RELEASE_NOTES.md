# Prompt Vault Release Notes

## Unreleased

### Highlights
- Added Prometheus-compatible HTTP instrumentation and an `/observability` router exposing liveness, readiness, and metrics endpoints for all entry points.
- Introduced an operational telemetry plugin to count prompt mutations and mirror lifecycle events into structured logs.
- Shipped `npm run extension:scaffold` to generate plugin templates alongside updated docs for agents and maintainers.
- Extended the Vitest suite with observability integration tests to guard metrics and health regressions.

### Upgrade Steps
1. Run `npm install` if dependencies drift (no new runtime packages were added).
2. Execute `npm run quality:gate` to exercise the updated observability tests.
3. Enable `PROMPT_VAULT_METRICS=true` and optionally set `PROMPT_VAULT_METRICS_PORT` so `/observability/metrics` can be scraped by your platform monitors.
4. Review `AUTOMATION.md`, `EXTENSION_GUIDE.md`, and `AGENTS.md` for the latest automation and plugin guidance before delegating work.

### Breaking Changes
- None.

### Operational Notes
- HTTP metrics now include request duration histograms (`prompt_vault_http_request_duration_seconds`) and counters for prompt write activity. Add alerting thresholds that reflect your SLOs.
- The operational telemetry plugin records lifecycle events; disable it only if you replace it with an equivalent handler to avoid losing write metrics.
- Coverage reporting still requires a V8 provider—expect warnings until `@vitest/coverage-v8` (or similar) is available in restricted registries.
- Every API response returns an `x-request-id` header mirrored in JSON error payloads; include it in support requests to speed log correlation.

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
