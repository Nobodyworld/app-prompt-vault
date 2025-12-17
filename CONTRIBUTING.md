# Contributing

This app lives in the Nobodyworld OS monorepo (`nobodyworld_full_build`) under `apps/app-prompt-vault/`.

## Preferred verification (VS Code)

- `Prompt Vault: Full Check`

## Setup

- Read `../../docs/DEV/DEV_WORKFLOW.md` (submodule guardrails, Windows/WSL gotchas).
- Install dependencies once at repo root:

```bash
pnpm install
```

## Common commands (from repo root)

```bash
pnpm --filter prompt-vault dev
pnpm --filter prompt-vault desktop:dev
pnpm --filter prompt-vault tauri:dev
pnpm --filter prompt-vault lint
pnpm --filter prompt-vault test
pnpm --filter prompt-vault quality:gate
```

## Prompt Vault docs

- Dev workflows: `docs/developer-guide/workflows.md`
- Extension/plugins: `docs/developer-guide/guides/extension-guide.md`
- Automation guardrails: `docs/operations/automation.md`

## Submodule workflow

Changes inside `apps/app-prompt-vault/` are changes to the app repo (submodule). Commit/push here first, then update the root repo submodule pointer.

See `../../docs/DEV/DEV_WORKFLOW.md` and `../../.github/instructions/nw.commit-workflow.instructions.md`.
