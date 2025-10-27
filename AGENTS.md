# Agent Instructions

Welcome! This repository already contains automation guardrails. Use this checklist when contributing via an agent workflow:

1. Always run `npm run quality:gate` before committing; it enforces linting, build output, coverage thresholds, and the security scan.
2. Enable metrics locally with `PROMPT_VAULT_METRICS=true` when touching observability code so `/observability/metrics`, `/healthz`, and `/readyz` reflect your changes.
3. Prefer the provided scaffolding helpers (`npm run extension:scaffold <name>`, `npm run release:prepare -- <version>`) over manual edits.
4. Keep documentation in sync with code—update `CHANGELOG.md`, `RELEASE_NOTES.md`, and relevant guides after feature work.
5. Tag follow-up work using `TODO(P#, <estimate>):` markers so prioritisation remains machine-readable.

Refer to `AUTOMATION.md` for deeper guardrails and `EXTENSION_GUIDE.md` when authoring plugins.
