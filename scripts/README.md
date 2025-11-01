# Scripts

Utility scripts that automate repository workflows live in this directory. They are written in TypeScript (or CommonJS where
Node hooks demand it) and can be executed via the npm scripts defined in `package.json`.

Key entry points:

- `bootstrap-db.ts` – Creates a SQLite database and applies migrations for local development.
- `metrics-snapshot.ts` – Generates code complexity, dependency, and latency samples for stewardship reports.
- `release-prepare.ts` – Bumps package versions and scaffolds changelog/release note sections.
- `scaffold-extension.ts` – Produces a plugin skeleton under `src/extensions/plugins/`.
- `security-scan.ts` – Wraps dependency scanning with repository-specific defaults.

Refer to [`README.md`](../README.md) for the full command list and to [`docs/operations/automation.md`](../docs/operations/automation.md)
for operational guardrails.
