# DB (app-prompt-vault)

Database adapters, migrations, and persistence helpers.

- Prefer explicit migrations and stable schemas.

Tables in this app are Prompt Vault-local (e.g. `prompts`, `prompt_versions`, tags, and search/fts helpers).
Migrations live in `src/db/migrations/` and are applied by the repository layer.
