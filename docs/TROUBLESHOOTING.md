# Troubleshooting (app-prompt-vault)

## Doc Meta

- **Tier:** 3

## Common Issues

- Desktop build failures: run `pnpm --filter prompt-vault desktop:build` and inspect the first Rollup/Vite error.
- Type errors: run `pnpm --filter prompt-vault typecheck`.

## Canonical Ops Docs

- Incident response: `docs/operations/incident-response.md`
- Monitoring: `docs/operations/monitoring.md`
- Backup & recovery: `docs/operations/backup-recovery.md`
