# Widgets (app-prompt-vault)

## Doc Meta

- **Tier:** 3

## Overview

Prompt Vault registers Hub-discoverable widgets via `@nw/pages-widgets`.

## Canonical Entry Points

- Registration code: `src/widgets/register.ts`
- Widget metadata: `src/widgets/index.ts`
- Widget manifest: `manifests/widgets.json`

## Widget Catalog

- `pv:quick-add` — Quick Add Prompt
- `pv:recent` — Recent Prompts (config: `{ limit: number }`)
- `pv:stats` — Prompt Stats

## Example

Widget config for `pv:recent`:

```json
{
  "limit": 10
}
```
