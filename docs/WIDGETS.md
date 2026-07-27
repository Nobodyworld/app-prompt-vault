# Widgets

## Overview

Prompt Vault owns its widget metadata and app-local registry. Installing the application does not require `@nw/pages-widgets` or the Nobodyworld Hub.

An external Hub may consume the exported definitions through a future adapter, but that integration must not become a standalone installation dependency.

## Canonical entry points

- Widget metadata: `src/widgets/index.ts`
- Registration code: `src/widgets/register.ts`
- App-local registry: `src/lib/platform-pages-widgets.ts`
- Static manifest: `manifests/widgets.json`

## Widget catalog

- `pv:quick-add` — Quick Add Prompt
- `pv:recent` — Recent Prompts, with optional `{ limit: number }` configuration
- `pv:stats` — Prompt Stats

## Registration contract

`registerPromptVaultWidgetsWithPagesWidgets()` registers the three definitions in the app-local registry. Tests or optional adapters can inspect the registry using `getRegisteredWidgets()`.

Registration is idempotent at the Prompt Vault wrapper level. A Hub adapter should read or translate the definitions rather than requiring Prompt Vault to import a private platform package.

## Example configuration

```json
{
  "limit": 10
}
```

## Release status

Widget metadata exists, but public-release proof still requires current-head tests and a demonstrated consumer path. Do not claim Hub integration is validated until an adapter and integration test exist.
