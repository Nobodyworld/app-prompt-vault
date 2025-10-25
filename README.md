# Prompt Vault

Prompt Vault is a cross-platform desktop vault for collecting, versioning, and tagging reusable prompts. The project includes a fully typed domain layer, a CLI for quick interactions, and a React UI hosted in a Tauri shell backed by a local SQLite database.

## Key Features

- **Prompt Library** – Create prompts with rich metadata, semantic versioning, and change history.
- **Tag Filtering** – Attach reusable tags to group prompts by workflow, team, or modality.
- **SQLite Persistence** – Store data locally with migrations managed inside the repo for reproducible environments.
- **Command-Line Interface** – Manage your library directly from the terminal.
- **Desktop UI** – React-based interface for easy prompt management.
- **Test Coverage** – Vitest suite exercises core business flows and guards against regressions.

## Project Layout

```text
app-prompt-vault/
├─ src/
│  ├─ cli/                 # Commander-based CLI utilities
│  ├─ db/                  # SQLite connection factory and migrations
│  ├─ domain/              # Models, errors, and validation schemas
│  ├─ repositories/        # Data access layer over SQLite
│  └─ services/            # PromptVaultService façade
├─ desktop/
│  ├─ src/                 # React UI components and pages
│  ├─ index.html           # App shell
│  ├─ vite.config.ts       # Vite configuration
│  └─ tsconfig.json        # TypeScript config for UI
├─ src-tauri/              # Tauri Rust backend
├─ tests/                  # Vitest specs for service workflows
├─ docs/                   # Step-by-step Codex chain documentation and architecture guides
├─ codex_chain.json        # Automation chain definition
├─ package.json            # Tooling, dependencies, and scripts
└─ tsconfig.json           # TypeScript compiler configuration
```

## Getting Started

> **Prerequisites:** Node.js 18.17+, Rust (for Tauri), and (optionally) SQLite libraries for native bindings.

```bash
# install dependencies
npm install

# run unit tests
npm test

# lint the project
npm run lint

# build TypeScript output to dist/
npm run build

# run desktop app in development
npm run desktop:dev

# build desktop app for production
npm run desktop:build
```

## CLI Usage

The CLI ships with the project to help you seed and explore the vault.

```bash
# Create a prompt with tags
npm run dev -- create \
  --slug blog-outline \
  --title "Blog Outline Generator" \
  --body "You are an expert copywriter..." \
  --version 1.0.0 \
  --tags marketing,writing

# List prompts matching a tag
npm run dev -- list --tags marketing

# Add a new version
npm run dev -- version --id <prompt-id> --body "Improved prompt" --version 1.1.0
```

The CLI stores data in `prompt-vault.db` by default. Pass `--db` to point to another SQLite database (e.g., `:memory:` during tests).

## Testing

Vitest powers the automated test suite.

```bash
# run tests once
npm test

# run in watch mode
echo "npm run test:watch"
```

Coverage reports are emitted under `coverage/` when tests run locally.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) – component relationships, data flow, and migration strategy.
- [`docs/workflows.md`](docs/workflows.md) – developer workflows, CLI recipes, and testing loops.
- [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md) – dependency inventory with security considerations.
- [`docs/`](docs/) – contains the full Codex chain step reports.

## Roadmap

1. Polish the UI with additional features like search and advanced filtering.
2. Introduce synchronization/export features for sharing prompt collections.
3. Add GitHub Actions workflows for CI (linting, testing, release bundles).

## License

This repository is distributed under a Proprietary license. All rights reserved.
