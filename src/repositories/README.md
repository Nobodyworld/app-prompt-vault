# Repositories (app-prompt-vault)

Repository interfaces + implementations for prompts/templates and related state.

Current implementation:

- `PromptRepository`: SQLite-backed repository (BetterSqlite3) that applies migrations on construction and provides CRUD + search APIs.

Services should depend on repositories (and domain types), not on raw SQL.
