# Developer Workflows

This document captures the most common developer and operator workflows for Prompt Vault.

## 1. Bootstrapping the Environment

1. Install Node.js 18.17 or newer.
2. Clone the repository and run `npm install` to install dependencies.
3. Optionally install SQLite CLI tools for inspecting databases created by the CLI.
4. Copy `.env.example` (future) if environment variables become necessary.

## 2. Running Automated Tests

```bash
npm test            # Executes the Vitest suite once
npm run test:watch  # Watches files and reruns tests incrementally
npm run quality:gate # Lint → build → tests with coverage thresholds → security scan
```

Vitest defaults to the Node environment. Tests rely on the `:memory:` SQLite database to remain hermetic and fast.

## 3. Using the CLI

```bash
npm run dev -- create --slug first --title "First Prompt" --body "Do X" --tags onboarding
npm run dev -- list
npm run dev -- version --id <prompt-id> --body "Updated" --version 1.1.0
npm run dev -- tag --id <prompt-id> --tags experiments,writing
npm run dev -- doctor   # Runs integrity check, counts prompts/tags, prints sample slugs
```

Enable metrics and health endpoints for any CLI invocation by exporting `PROMPT_VAULT_METRICS=true` (set `PROMPT_VAULT_METRICS_PORT` to override the default 9464). By default the CLI writes to `prompt-vault.db` in the repository root. Delete the file to reset your dataset.

## 4. Database Maintenance

- Migrations live under `src/db/migrations/`.
- When introducing a new migration, copy the previous file, increment the prefix, and add your SQL changes.
- Update `PromptRepository.applyMigrations` if a more sophisticated migration runner is introduced.
- Deployments that relocate SQL files can set `PROMPT_VAULT_MIGRATIONS_DIR` to point at the correct directory; defaults resolve relative to the running module.

## 5. Observability Toolkit

- Start a standalone health/metrics server with `npm run observability`. The process will stay alive until interrupted.
- Inspect metrics via `curl http://localhost:9464/metrics` (or your configured port).
- Health endpoints:
  - `/healthz` – liveness (process running)
  - `/readyz` – readiness (SQLite connection currently open)
- Telemetry spans follow the `service.*`, `repository.*`, and `plugin.*` naming conventions; use them to identify hot paths.

## 6. Stewardship Metrics

- Run `npm run metrics:snapshot` to print cyclomatic complexity, dependency fan-out, and a 50-prompt latency sample.
- Copy relevant numbers into `docs/reports/stewards-report.md` (or dashboards) during major releases.
- When metrics regress, prioritise targeted refactors (e.g., repositories > 2.5 average complexity) before shipping new features.

## 7. Releasing Builds

1. Run `npm run build` to emit compiled TypeScript.
2. Run `npm run release:prepare -- <version>` to bump package metadata and generate changelog/release-note stubs.
3. Package the CLI as part of the Tauri bundle or as a standalone Node executable.
4. Publish release notes using the generated templates and replace any placeholder text with final copy.
5. Tag the release (e.g., `git tag v0.2.0`) and push.

## 8. Troubleshooting

- **SQLite module fails to load**: ensure build tools for native Node modules are available (Python, C/C++ toolchain).
- **Validation errors**: inspect the aggregated `ValidationError` messages to see which schema rule failed.
- **Missing prompts**: confirm you are operating against the correct database path (pass `--db :memory:` for ephemeral runs).

Keeping workflows codified ensures onboarding remains smooth as the team grows.
