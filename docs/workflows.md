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
```

Vitest defaults to the Node environment. Tests rely on the `:memory:` SQLite database to remain hermetic and fast.

## 3. Using the CLI

```bash
npm run dev -- create --slug first --title "First Prompt" --body "Do X" --tags onboarding
npm run dev -- list
npm run dev -- version --id <prompt-id> --body "Updated" --version 1.1.0
npm run dev -- tag --id <prompt-id> --tags experiments,writing
```

By default the CLI writes to `prompt-vault.db` in the repository root. Delete the file to reset your dataset.

## 4. Database Maintenance

- Migrations live under `src/db/migrations/`.
- When introducing a new migration, copy the previous file, increment the prefix, and add your SQL changes.
- Update `PromptRepository.applyMigrations` if a more sophisticated migration runner is introduced.

## 5. Releasing Builds (Future)

1. Run `npm run build` to emit compiled TypeScript.
2. Package the CLI as part of the Tauri bundle or as a standalone Node executable.
3. Publish release notes using the template in `CHANGELOG.md`.
4. Tag the release (e.g., `git tag v0.2.0`) and push.

## 6. Troubleshooting

- **SQLite module fails to load**: ensure build tools for native Node modules are available (Python, C/C++ toolchain).
- **Validation errors**: inspect the aggregated `ValidationError` messages to see which schema rule failed.
- **Missing prompts**: confirm you are operating against the correct database path (pass `--db :memory:` for ephemeral runs).

Keeping workflows codified ensures onboarding remains smooth as the team grows.
