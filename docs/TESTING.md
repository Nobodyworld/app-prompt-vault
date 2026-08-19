# Testing (app-prompt-vault)

## Doc Meta

- **Tier:** 3

## Overview

This document is a stable entrypoint for test workflow docs.

## Canonical Docs

- Testing guide: `docs/operations/monitoring.md` (runtime checks) and `docs/developer-guide/` (developer workflow)
- Validation ownership and external-runner boundary: `docs/developer-guide/validation-boundaries.md`

## Validation Ownership

Prompt Vault retains directly runnable repository tests, product-specific fixtures, and acceptance contracts. Reusable installed/native execution may transition to an external registered validation runner only after the parity and fallback gates in the validation-boundary document are accepted.

## Commands

- Unit/integration tests: `pnpm --filter prompt-vault test`
- E2E (Vitest): `pnpm --filter prompt-vault test:e2e`
- UI tests (Playwright): `pnpm --filter prompt-vault test:ui`
- Desktop build smoke: `pnpm --filter prompt-vault desktop:build`
