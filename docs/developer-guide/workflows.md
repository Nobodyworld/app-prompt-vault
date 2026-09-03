# Developer Workflows

This document captures the most common developer and operator workflows for Prompt Vault.

## 1. Bootstrapping the Environment

1. Install Node.js 24.x LTS (minimum `>=24.0.0`).
2. Clone the repository and run `pnpm install --frozen-lockfile` to install dependencies.
3. Optionally install SQLite CLI tools for inspecting databases created by the CLI.
4. Copy `.env.example` (future) if environment variables become necessary.

## 2. Running Automated Tests

```bash
pnpm test             # Executes the Vitest suite once
pnpm test:watch       # Watches files and reruns tests incrementally
pnpm quality:gate     # Audit → lint → builds → feedback exclusion → coverage → security
```

Vitest defaults to the Node environment. Tests rely on the `:memory:` SQLite database to remain hermetic and fast.

## 3. Using the CLI

```bash
pnpm dev -- create --slug first --title "First Prompt" --body "Do X" --tags onboarding
pnpm dev -- list
pnpm dev -- version --id <prompt-id> --body "Updated" --version 1.1.0
pnpm dev -- tag --id <prompt-id> --tags experiments,writing
pnpm dev -- doctor   # Runs integrity check, counts prompts/tags, prints sample slugs
```

Enable metrics and health endpoints for any CLI invocation by exporting `PROMPT_VAULT_METRICS=true` (set `PROMPT_VAULT_METRICS_PORT` to override the default 9464). By default the CLI writes to `prompt-vault.db` in the repository root. Delete the file to reset your dataset.

## 4. Database Maintenance

- Migrations live under `src/db/migrations/`.
- When introducing a new migration, copy the previous file, increment the prefix, and add your SQL changes.
- Update `PromptRepository.applyMigrations` if a more sophisticated migration runner is introduced.
- Deployments that relocate SQL files can set `PROMPT_VAULT_MIGRATIONS_DIR` to point at the correct directory; defaults resolve relative to the running module.

## 5. Observability Toolkit

- Start a standalone health/metrics server with `pnpm observability`. The process will stay alive until interrupted.
- Inspect metrics via `curl http://localhost:9464/metrics` (or your configured port).
- Health endpoints:
  - `/healthz` – liveness (process running)
  - `/readyz` – readiness (SQLite connection currently open)
- Telemetry spans follow the `service.*`, `repository.*`, and `plugin.*` naming conventions; use them to identify hot paths.

## 6. Stewardship Metrics

- Run `pnpm metrics:snapshot` to print cyclomatic complexity, dependency fan-out, and a 50-prompt latency sample.
- Copy relevant numbers into `docs/reports/stewards-report.md` (or dashboards) during major releases.
- When metrics regress, prioritise targeted refactors (e.g., repositories > 2.5 average complexity) before shipping new features.

## 7. Preparing an application-version source milestone

1. Update `package.json`, the canonical application-version source, through
   `pnpm release:prepare -- <MAJOR.MINOR.PATCH>`.
2. Review every synchronized package, Tauri, Cargo, lockfile, CLI/runtime, and
   project-stage surface with `pnpm version:check`.
3. Replace changelog and release-note placeholders with truthful source-preview
   milestone text.
4. Run the complete Node, UI, Rust, security, and Tauri build matrix at the
   exact candidate commit.

Application-version preparation does not authorize or create a Git tag, GitHub
Release, signed or supported installer distribution, update feed, installation,
application launch, or database operation. Those remain separately reviewed
gates. See [Application version policy](version-policy.md).

## 8. Troubleshooting

- **SQLite module fails to load**: ensure build tools for native Node modules are available (Python, C/C++ toolchain).
- **Validation errors**: inspect the aggregated `ValidationError` messages to see which schema rule failed.
- **Missing prompts**: confirm you are operating against the correct database path (pass `--db :memory:` for ephemeral runs).

Keeping workflows codified ensures onboarding remains smooth as the team grows.
