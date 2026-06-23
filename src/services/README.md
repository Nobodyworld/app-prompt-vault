# Services (app-prompt-vault)

Business logic services that sit above repositories (validation, rendering, sync).

Primary service:

- `PromptVaultService`: Orchestrates repository calls, validation, template rendering, tags, and plugin hooks.

Errors are defined in `src/domain/errors.ts`.
