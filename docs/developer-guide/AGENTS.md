# Agent Notes (Prompt Vault in Nobodyworld)

In this repo (`nobodyworld_full_build`), Prompt Vault is developed via the **pnpm workspace**.
Keep agent policy centralized at the root:

- Baseline invariants (no agent logs, Git Maintainer only, don’t restore deletions): `../../../../.github/instructions/nw.base.instructions.md`
- Commit workflow (apps first, then root): `../../../../.github/instructions/nw.commit-workflow.instructions.md`

Checklist when working on Prompt Vault:

1. Prefer VS Code tasks (repeatable): `Prompt Vault: Full Check`.
2. If working on observability, enable metrics: set `PROMPT_VAULT_METRICS=true` so `/observability/metrics`, `/healthz`, and `/readyz` reflect your changes.
3. Prefer existing app scripts, but run them via pnpm filter (examples):
 - `pnpm --filter prompt-vault release:prepare -- <version>`
 - `pnpm --filter prompt-vault extension:scaffold -- <name>`
4. Keep docs in sync with code (e.g. `CHANGELOG.md`, `docs/releases/notes.md`, and relevant guides).
5. Tag follow-up work using `TODO(P#, <estimate>):` markers so prioritization remains machine-readable.

For deeper automation guardrails, see `docs/operations/automation.md` and `docs/guides/extension-guide.md`.
