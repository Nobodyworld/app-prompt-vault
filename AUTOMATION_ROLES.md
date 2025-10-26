# Automation Roles

This registry maps potential agent responsibilities to the scripts and guardrails shipped with Prompt Vault.

## Roles

### Quality Gate Runner
- **Trigger:** On pull request open/update or nightly cron.
- **Command:** `npm run quality:gate`
- **Outputs:** Lint, build artifacts, test results, coverage summary (warns if V8 provider unavailable), security audit logs.
- **Notes:** Respect `npm audit` 403 fallbacks; archive `coverage/` JSON for manual review.

### Metrics Steward
- **Trigger:** Weekly or before milestone releases.
- **Command:** `npm run metrics:snapshot`
- **Outputs:** Complexity summary, dependency graph fan-out, 50 prompt latency sample.
- **Notes:** Store console output in `STEWARDS_REPORT.md` or dashboards; rerun after major refactors.

### Release Scribe
- **Trigger:** Before tagging a release candidate.
- **Command:** `npm run release:prepare -- <version>`
- **Outputs:** Bumped `package.json`, updated lockfile metadata, CHANGELOG/RELEASE_NOTES scaffolding.
- **Notes:** Update TODO placeholders with human-friendly copy prior to publishing.

### Observability Keeper
- **Trigger:** Deployments, incident rehearsals.
- **Command:** `npm run observability`
- **Outputs:** Metrics/health endpoints for smoke testing and dashboards.
- **Notes:** Pair with `npm run dev -- doctor` to capture integrity snapshots.

## Safety Tags
Scripts annotated with `// # agent-entrypoint` or `// # agent-safe-task` signal code paths that agents may invoke or extend without bypassing guardrails. When adding new automation helpers, include the appropriate tag and document the workflow here.
