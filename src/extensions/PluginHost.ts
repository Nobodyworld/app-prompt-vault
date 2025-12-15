import type { Prompt, PromptId, PromptVersion, Tag } from "../domain/models.js";
import type { PromptVaultActorContext, PromptVaultConnector, PromptVaultPlugin, PromptVaultPluginContext, PluginMetadata } from "./types.js";
import type { StructuredLogger } from "../observability/logger.js";
import type { Telemetry } from "../observability/telemetry.js";

export class PluginHost {
  private readonly plugins: PromptVaultPlugin[] = [];
  private readonly connectors: PromptVaultConnector[] = [];
  private readonly context: PromptVaultPluginContext;
  private readonly logger: StructuredLogger;

  public constructor(options: { logger: StructuredLogger; telemetry: Telemetry }) {
    this.logger = options.logger;
    this.context = { logger: this.logger, telemetry: options.telemetry };
  }

  public register(plugin: PromptVaultPlugin): void {
    this.plugins.push(plugin);
    this.logger.info("plugin_registered", { plugin: plugin.name });

    // Register plugin connectors
    if (plugin.connectors) {
      for (const connector of plugin.connectors) {
        this.registerConnector(connector);
      }
    }

    plugin.setup?.(this.context);
  }

  public registerConnector(connector: PromptVaultConnector): void {
    this.connectors.push(connector);
    this.logger.info("connector_registered", {
      connector: connector.name,
      type: connector.type
    });
    connector.setup?.(this.context);
  }

  public async connectAll(): Promise<void> {
    for (const connector of this.connectors) {
      if (connector.connect) {
        try {
          await connector.connect();
          this.logger.info("connector_connected", {
            connector: connector.name,
            type: connector.type
          });
        } catch (error) {
          this.logger.error("connector_connection_failed", {
            connector: connector.name,
            type: connector.type,
            error: error instanceof Error ? error.message : error,
          });
        }
      }
    }
  }

  public async disconnectAll(): Promise<void> {
    for (const connector of this.connectors) {
      if (connector.disconnect) {
        try {
          await connector.disconnect();
          this.logger.info("connector_disconnected", {
            connector: connector.name,
            type: connector.type
          });
        } catch (error) {
          this.logger.warn("connector_disconnection_failed", {
            connector: connector.name,
            type: connector.type,
            error: error instanceof Error ? error.message : error,
          });
        }
      }
    }
  }

  public getPlugins(): readonly PromptVaultPlugin[] {
    return this.plugins;
  }

  public getConnectors(): readonly PromptVaultConnector[] {
    return this.connectors;
  }

  public getPluginMetadata(): PluginMetadata[] {
    return this.plugins.map(plugin => ({
      name: plugin.name,
      version: plugin.version ?? "1.0.0",
      description: plugin.description,
      path: "", // Built-in plugins don't have filesystem paths
      enabled: true,
    }));
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
  onPromptCreated: { prompt: Prompt; version: PromptVersion; actor?: PromptVaultActorContext };
  onPromptUpdated: { prompt: Prompt; updatedFields: readonly string[]; actor?: PromptVaultActorContext };
  onPromptDeleted: { promptId: PromptId; mode: "soft" | "permanent"; actor?: PromptVaultActorContext };
  onVersionAdded: { promptId: PromptId; version: PromptVersion };
  onPromptTagged: { promptId: PromptId; tags: readonly Tag[] };
  onPromptUntagged: { promptId: PromptId; labels: readonly string[] };
}
