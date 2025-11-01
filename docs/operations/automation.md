# Automation & Agent Operations

This repository is automation-friendly: it ships structured telemetry, deterministic scripts, and documented guardrails so local or cloud agents can contribute safely.

## Golden Rules

1. **Never write secrets** to the repository. Use environment variables or injected files when running workflows.
2. **Prefer provided scripts** (`npm run validate`, `npm run observability`, `npm run release:prepare`) over ad-hoc commands to ensure consistent tooling.
3. **Respect coverage gates.** The CI workflow enforces linting, type checks, tests, security audit, and coverage thresholds—agents must run `npm run quality:gate` locally before opening PRs.
4. **Tag new TODOs** with `TODO(P#, <estimate>):` so prioritisation stays machine-readable.

## Recommended Environment Variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `PROMPT_VAULT_METRICS` | Enable health + metrics endpoints | `false` |
| `PROMPT_VAULT_METRICS_PORT` | Override metrics port | `9464` |
| `PROMPT_VAULT_LOG_LEVEL` | Structured log level (`debug/info/warn/error`) | `info` |

## Common Tasks

| Task | Command |
| --- | --- |
| Bootstrap dependencies | `npm install` |
| Run quality gate | `npm run quality:gate` |
| Snapshot metrics/complexity | `npm run metrics:snapshot` |
| Start observability server | `npm run observability` (exports `/observability/*` and Prometheus metrics until interrupted) |
| Run CLI doctor | `npm run dev -- doctor` |
| Scaffold a plugin template | `npm run extension:scaffold <name>` |
| Prepare release notes + changelog stub | `npm run release:prepare -- <version>` |

## Agent Safety Patterns

- **Read-only first:** Parse documentation (`docs/architecture/overview.md`, `docs/guides/extension-guide.md`) before editing.
- **Dry runs:** Use `npm run dev -- <command>` to validate CLI behaviour against an in-memory database (`--db :memory:`) before touching production files.
- **Telemetry:** Enable metrics locally during automation to capture span timings and log context for debugging runs (`PROMPT_VAULT_METRICS=true`). Scrape `/observability/metrics` to confirm instrumentation is healthy.
- **PR Authoring:** Summaries should cite documentation updates and mention any residual risks flagged in `docs/releases/notes.md`.

## Change Coordination

- Dependabot is configured for weekly npm updates. Agents should review resulting PRs for compatibility before merging.
- Release automation expects semantic versioning. Use `npm run release:prepare -- <version>` to bump `package.json`, regenerate changelog stubs, and update release notes templates.

By following these guardrails, agents can iterate rapidly while preserving the repository's long-term health.
