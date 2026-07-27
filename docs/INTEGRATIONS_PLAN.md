# Integrations Plan

## Objective

Prompt Vault is standalone-first. External Nobodyworld, Hub, marketplace, Planner, Buttons, or agent integrations must consume app-owned contracts through optional adapters and must not become installation prerequisites.

## Stable identifiers

- App/package ID: `prompt-vault`
- Tool `source`: `prompt-vault`
- Widget `appId`: `prompt-vault`
- Prompt lifecycle events:
  - `pv:prompt_created`
  - `pv:prompt_updated`
  - `pv:prompt_deleted`

## App-owned entry points

- Tool definitions and handlers: `src/tools/index.ts`
- Tool registry and invocation: `src/lib/platform-orchestrator.ts`
- Widget metadata: `src/widgets/index.ts`
- Widget registry: `src/lib/platform-pages-widgets.ts`
- Prompt lifecycle/event bridge: `src/lib/nw-bridge.ts`
- Tag/project and auth compatibility: `src/lib/platform-core.ts`
- Static widget manifest: `manifests/widgets.json`

The historical `nw-bridge` filename is retained for compatibility, but its current dependencies are app-owned. Future adapters may be moved into separately installable packages.

## Integration principles

1. Prompt Vault must install, build, test, and package without external platform packages.
2. Integration adapters depend on Prompt Vault contracts; Prompt Vault does not depend on a specific Hub implementation.
3. Network or agent-triggered writes retain confirmation and authentication requirements.
4. Prompt bodies, credentials, and tokens never enter event payloads, logs, or telemetry.
5. Adapter failures must not prevent local prompt CRUD, search, copy, versioning, export, or restart.
6. Integration claims require an executable contract/integration test.

## Event contracts

The in-process event bus is typed by `PlatformEventMap` in `src/lib/platform-core.ts`.

Published Prompt Vault events carry identifiers and optional actor/request context, not prompt content:

```typescript
interface PromptLifecycleEvent {
  promptId: string;
  actorUserId?: string;
  requestId?: string;
}
```

External adapters may forward these events, but should preserve the minimal payload and add transport metadata outside the domain event.

## Tool contracts

The authoritative definitions live in `promptVaultToolDefinitions` under `src/tools/index.ts`. The app-local registry supports registration, lookup, reset for tests, and direct invocation.

Common result shape:

```typescript
interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  code?: string;
  validationErrors?: string[];
}
```

External orchestrators should translate their transport/runtime context into the app-owned `ToolContext` rather than requiring Prompt Vault to import a platform SDK.

## Widget contracts

The authoritative definitions live under `src/widgets/`. An external Hub adapter may consume the static manifest or `getRegisteredWidgets()` and translate definitions into its own registry.

## Planned adapters

- Nobodyworld Hub widget adapter
- Nobodyworld orchestrator adapter
- Planner AiDo import/export adapter
- Workflow Buttons switchboard adapter
- Marketplace prompt-pack installer
- Optional external event transport

Each adapter should live behind an explicit package or entry point and have its own compatibility tests.

## Release status

The standalone contracts are implemented but not current-head runtime validated because GitHub runner jobs fail before their first step. Do not claim these integrations work end to end until the relevant adapter and test evidence exist.
