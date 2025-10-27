import type { Prompt, PromptId, PromptVersion, Tag } from "../domain/models.js";
import type { PromptVaultPlugin, PromptVaultPluginContext } from "./types.js";
import type { StructuredLogger } from "../observability/logger.js";
import type { Telemetry } from "../observability/telemetry.js";

export class PluginHost {
  private readonly plugins: PromptVaultPlugin[] = [];

  private readonly context: PromptVaultPluginContext;

  private readonly logger: StructuredLogger;

  public constructor(options: { logger: StructuredLogger; telemetry: Telemetry }) {
    this.logger = options.logger;
    this.context = { logger: this.logger, telemetry: options.telemetry };
  }

  public register(plugin: PromptVaultPlugin): void {
    this.plugins.push(plugin);
    this.logger.info("plugin_registered", { plugin: plugin.name });
    plugin.setup?.(this.context);
  }

  public emit<Event extends keyof PluginEvents>(
    event: Event,
    payload: PluginEvents[Event]
  ): void {
    for (const plugin of this.plugins) {
      const handler = plugin[event] as ((payload: PluginEvents[Event]) => void) | undefined;
      if (!handler) {
        continue;
      }
      this.context.telemetry.withSpan(`plugin.${plugin.name}.${String(event)}`, {}, () => {
        try {
          handler.call(plugin, payload);
        } catch (error) {
          this.logger.warn("plugin_handler_failed", {
            plugin: plugin.name,
            event,
            error: error instanceof Error ? error.message : error,
          });
        }
      });
    }
  }
}

interface PluginEvents {
  onPromptCreated: { prompt: Prompt; version: PromptVersion };
  onVersionAdded: { promptId: PromptId; version: PromptVersion };
  onPromptTagged: { promptId: PromptId; tags: readonly Tag[] };
  onPromptUntagged: { promptId: PromptId; labels: readonly string[] };
}
