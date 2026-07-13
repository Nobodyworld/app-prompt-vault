# Legacy tag/project sidecar migration

PR #27 replaces the private Nobodyworld tags/Core DB dependency with an app-owned SQLite sidecar. Existing internal installations may have tag and project relationships in a legacy Nobodyworld Core DB such as `*.core.db`.

The historical Core DB is not a tag-only file. It may legitimately contain `prompts`, `prompt_versions`, settings, pages, and other platform tables alongside `tags` and `taggings`. The migration reads only the tag tables and writes into a separate app-owned target.

Do not point the new runtime directly at an unreviewed legacy database. Migrate into a separate target file first.

## Safety rules

1. Stop Prompt Vault before copying or migrating databases.
2. Back up the main prompt database and legacy Core DB.
3. Keep the source and target paths different.
4. Run a dry run before writing.
5. Inspect the JSON counts and preserve the original source until restart/persistence verification is complete.
6. Never pass the standalone Prompt Vault database as the migration source. A recognized legacy Core DB must contain `schema_migrations`, `settings`, `pages`, `tags`, and `taggings` with the expected legacy columns.
7. Never use the main Prompt Vault database or the legacy Core DB itself as the target. Use a new app-owned sidecar path.

## Dry run

```bash
pnpm tags:migrate-legacy -- \
  --source ./prompt-vault.db.core.db \
  --target ./prompt-vault-platform.db \
  --dry-run
```

The dry run opens the source read-only, validates the Core DB marker tables and legacy tag columns, reports source counts, and does not create or modify the target.

Environment variables may be used instead:

```bash
PROMPT_VAULT_LEGACY_TAG_DB_PATH=./prompt-vault.db.core.db
PROMPT_VAULT_TAG_DB_PATH=./prompt-vault-platform.db
pnpm tags:migrate-legacy -- --dry-run
```

## Migration

After reviewing the dry-run output:

```bash
pnpm tags:migrate-legacy -- \
  --source ./prompt-vault.db.core.db \
  --target ./prompt-vault-platform.db
```

The migration:

- reads only legacy `tags` and `taggings` rows from the broader Core DB;
- preserves tag IDs when possible;
- accepts legacy `name` or `label` and maps legacy `type` to the app-owned `kind` field;
- preserves project-prefixed names, labels/descriptions, colors, archive state, and timestamps;
- preserves prompt/entity associations and normalizes a missing context to an empty context;
- reuses an existing target tag with the same case-insensitive name and kind;
- runs target writes inside a transaction;
- can be repeated without duplicating tag associations.

## Configure the migrated target

Set the target path before starting Prompt Vault:

```bash
PROMPT_VAULT_TAG_DB_PATH=./prompt-vault-platform.db
```

For a network-accessible deployment, also set the required authentication and CORS variables described in the main README.

## Required verification

Before deleting or archiving the legacy source:

1. Start Prompt Vault against the migrated target.
2. Verify normal labels and project tags appear.
3. Verify project-scoped search returns the expected prompts.
4. Tag and untag a test prompt.
5. Restart the application.
6. Repeat the search and tag checks.
7. Export a backup bundle.

Issue #28 remains open until this procedure passes against a representative copy of an existing internal database and the automated test suite runs successfully on the current PR head.
