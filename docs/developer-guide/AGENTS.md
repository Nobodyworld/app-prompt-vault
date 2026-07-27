# Agent Notes

Prompt Vault is now maintained as a standalone-first repository. The source tree must remain installable without the Nobodyworld monorepo, private `@nw/*` packages, parent configuration, or parent type roots.

## Checklist

1. Read `README.md`, `CONTRIBUTING.md`, and the open release issues before changing code.
2. Preserve the app-owned platform boundary documented in `standalone-dependency-matrix.md`.
3. Use repository scripts directly rather than pnpm workspace filters.
4. Keep `CHANGELOG.md`, release notes, and relevant guides aligned with the implementation.
5. Add tests for every persistence, migration, auth, HTTP, tool, widget, or native behavior change.
6. Record exact validation commands and results. State clearly when GitHub runner startup or local dependencies prevent execution.
7. Keep confirmed follow-up work in GitHub issues linked from the active PR.

## Common commands

```bash
pnpm repository:audit
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:coverage
pnpm test:ui
pnpm desktop:build
pnpm release:prepare -- <version>
pnpm extension:scaffold -- <name>
pnpm tags:migrate-legacy -- --source <legacy.core.db> --target <platform.db> --dry-run
```

## Observability

Set `PROMPT_VAULT_METRICS=true` when validating metrics and readiness behavior. Confirm `/observability/metrics`, `/healthz`, and `/readyz` without logging prompt bodies or secrets.

## Standalone and migration guardrails

- Do not add `workspace:*`, private `@nw/*`, or parent-repository paths.
- Never use the main Prompt Vault database or a legacy Core DB as the new tag/project sidecar.
- Use the explicit legacy migration command with a separate target and dry run.
- Keep external Hub/orchestrator integration behind optional adapters.

For deeper guardrails, see:

- `docs/operations/automation.md`
- `docs/developer-guide/guides/extension-guide.md`
- `docs/developer-guide/legacy-tag-migration.md`
- `docs/developer-guide/standalone-dependency-matrix.md`
