# Testing (app-prompt-vault)

## Doc Meta

- **Tier:** 3

## Overview

This document is a stable entrypoint for test workflow docs.

## Canonical Docs

- Testing guide: `docs/operations/monitoring.md` (runtime checks) and `docs/developer-guide/` (developer workflow)

## Commands

- Unit/integration tests: `pnpm --filter prompt-vault test`
- E2E (Vitest): `pnpm --filter prompt-vault test:e2e`
- UI tests (Playwright): `pnpm --filter prompt-vault test:ui`
- Desktop build smoke: `pnpm --filter prompt-vault desktop:build`
