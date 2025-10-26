# Extension Guide

Prompt Vault now exposes a lightweight plugin system for augmenting prompt workflows without forking the core service. This guide explains the extension contract and ships a starter template for building new modules.

## When to Use Plugins

Use plugins to:

- Emit audit or analytics events when prompts or versions change.
- Synchronise prompt metadata to external systems (knowledge bases, chat platforms, etc.).
- Enforce organisation-specific rules (e.g., tag whitelists) before writes.

Keep domain validation, migrations, and persistence inside the core service—plugins should remain side-effect oriented.

## Plugin Lifecycle

1. **Registration.** Pass plugin instances to `PromptVaultService` via the `plugins` option. The CLI registers the bundled audit trail plugin automatically.
2. **Setup hook.** `setup(context)` fires immediately with a logger + telemetry handle. Use it to initialise connections or schedule timers.
3. **Event hooks.** Implement any of the optional callbacks:
   - `onPromptCreated({ prompt, version })`
   - `onVersionAdded({ promptId, version })`
   - `onPromptTagged({ promptId, tags })`

Handlers execute inside telemetry spans (`plugin.<name>.<event>`) so metrics capture execution time and failures.

## Starter Template

Create a new file under `src/extensions/plugins/yourPluginName.ts`:

```ts
import type { PromptVaultPlugin } from "../types.js";

export function createExamplePlugin(): PromptVaultPlugin {
  return {
    name: "example",
    setup({ logger }) {
      logger.info("example_plugin_booted");
    },
    onPromptCreated({ prompt }) {
      // TODO(P3, 1d): push prompt metadata to downstream system
    },
  };
}
```

Register it when constructing `PromptVaultService`:

```ts
import { PromptVaultService } from "../services/PromptVaultService.js";
import { createExamplePlugin } from "../extensions/plugins/examplePlugin.js";

const service = new PromptVaultService(database, {
  plugins: [createExamplePlugin()],
});
```

## Testing Plugins

- Use Vitest to instantiate `PromptVaultService` with your plugin and perform actions that trigger hooks. Assertions ensure side-effects occurred.
- The telemetry context is available via `context.telemetry` inside `setup` and event handlers. You can record custom events or child spans for additional metrics.

## Packaging Guidelines

- Keep plugins stateless or reset them between runs (the CLI creates fresh instances per invocation).
- Avoid blocking operations inside hooks—hand off work to queues or async workers when possible. If a hook throws, the core service logs a warning and continues to preserve user experience.
- Document configuration knobs in `docs/workflows.md` or a plugin-specific README.

Following this guide keeps extensions modular, observable, and safe to run in automated environments.
