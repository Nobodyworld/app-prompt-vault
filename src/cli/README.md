# CLI (app-prompt-vault)

CLI entrypoints for Prompt Vault (coordinated conventions across apps).

Primary entrypoint: `src/cli/index.ts`.

This CLI is intended for local/dev workflows and operational tasks (searching, creating, importing/exporting prompts, diagnostics).
It bootstraps observability via `bootstrapObservabilityFromEnv` and uses `PromptVaultService` for behavior.
