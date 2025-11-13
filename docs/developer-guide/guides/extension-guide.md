# Extension Guide

Prompt Vault now exposes a lightweight plugin system for augmenting prompt workflows without forking the core service. This guide explains the extension contract and ships a starter template for building new modules.

## When to Use Plugins

Use plugins to:

- Emit audit or analytics events when prompts or versions change.
- Synchronise prompt metadata to external systems (knowledge bases, chat platforms, etc.).
- Enforce organisation-specific rules (e.g., tag whitelists) before writes.

Keep domain validation, migrations, and persistence inside the core service—plugins should remain side-effect oriented.

## Plugin Lifecycle

1. **Registration.** Pass plugin instances to `PromptVaultService` via the `plugins` option. The CLI registers the bundled audit trail and operational telemetry plugins automatically.
2. **Setup hook.** `setup(context)` fires immediately with a logger + telemetry handle. Use it to initialise connections or schedule timers.
3. **Event hooks.** Implement any of the optional callbacks:
   - `onPromptCreated({ prompt, version })`
   - `onVersionAdded({ promptId, version })`
   - `onPromptTagged({ promptId, tags })`
   - `onPromptUntagged({ promptId, labels })`

Handlers execute inside telemetry spans (`plugin.<name>.<event>`) so metrics capture execution time and failures.

## Starter Template

You can scaffold a plugin skeleton with the provided script:

```bash
npm run extension:scaffold operations
```

This command now generates `src/extensions/plugins/operationsPlugin.ts` with stub implementations for every lifecycle hook and a helper that reuses the plugin context (logger + telemetry) outside of `setup()`. Replace the placeholder telemetry calls with your organisation-specific side-effects.

If you prefer to write one manually, start from the same pattern:

```ts
import type { PromptVaultPlugin, PromptVaultPluginContext } from "../types.js";

export function createExamplePlugin(): PromptVaultPlugin {
  let context: PromptVaultPluginContext | undefined;

  function withContext(callback: (ctx: PromptVaultPluginContext) => void): void {
    if (!context) {
      return;
    }
    callback(context);
  }

  return {
    name: "example",
    setup(pluginContext) {
      context = pluginContext;
      pluginContext.logger.info("example_plugin_booted");
    },
    onPromptCreated({ prompt, version }) {
      withContext(({ telemetry }) => {
        telemetry.recordEvent("plugin.example.prompt_created", {
          promptId: prompt.id,
          semanticVersion: version.semanticVersion,
        });
      });
    },
    onPromptUntagged({ promptId, labels }) {
      withContext(({ logger }) => {
        logger.info("plugin.example.prompt_untagged", { promptId, labels });
      });
    },
  };
}
```

Register it when constructing `PromptVaultService` (or export it from `src/extensions/index.ts` for reuse):

```ts
import { PromptVaultService } from "../services/PromptVaultService.js";
import { createExamplePlugin } from "../extensions/plugins/examplePlugin.js";

const service = new PromptVaultService(database, {
  plugins: [createExamplePlugin()],
});
```

The repository ships with `createOperationalTelemetryPlugin()` as a reference implementation that records metrics and telemetry events for every prompt mutation. Use it as a blueprint for more advanced integrations (Slack notifications, remote sync, etc.).

## Testing Plugins

- Use Vitest to instantiate `PromptVaultService` with your plugin and perform actions that trigger hooks. Assertions ensure side-effects occurred.
- The telemetry context is available via `context.telemetry` inside `setup` and event handlers. You can record custom events or child spans for additional metrics.

## Packaging Guidelines

- Keep plugins stateless or reset them between runs (the CLI creates fresh instances per invocation).
- Avoid blocking operations inside hooks—hand off work to queues or async workers when possible. If a hook throws, the core service logs a warning and continues to preserve user experience.
- Document configuration knobs in `docs/workflows.md` or a plugin-specific README.

Following this guide keeps extensions modular, observable, and safe to run in automated environments.
