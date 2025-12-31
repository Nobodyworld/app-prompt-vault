# Integrations Plan (app-prompt-vault)

## Doc Meta

- **Tier:** 3

This document tracks how `app-prompt-vault` integrates with the Nobodyworld OS platform and `app-hub`.

## Identifiers

- Marketplace package ID: `prompt-vault`
- Orchestrator tool `source`: `prompt-vault`
- Widget `appId`: `prompt-vault`

## Entry Points

- Platform wiring: `src/lib/nw-bridge.ts` → `initializeNwIntegrations()`
- Tools: `src/tools/index.ts` → `registerPromptVaultTools()`
- Widget manifest: `manifests/widgets.json`

## Notes

- Deeper integration docs live under `docs/developer-guide/`.
- TODO: Document the stable cross-app contracts (events + tool payload schemas).
