import type { PromptVaultPlugin, PromptVaultPluginContext } from "../src/extensions/types.ts";

export function createTestPlugin(): PromptVaultPlugin {
  let context: PromptVaultPluginContext | undefined;

  function withContext<T>(callback: (ctx: PromptVaultPluginContext) => T): T | void {
    if (!context) {
      return undefined;
    }
    return callback(context);
  }

  return {
    name: "test-external-plugin",
    version: "1.0.0",
    description: "A test external plugin for demonstration",
    setup(pluginContext) {
      context = pluginContext;
      pluginContext.logger.info("test_external_plugin_ready");
      pluginContext.telemetry.recordEvent("plugin.test-external-plugin.setup");
    },
    onPromptCreated({ prompt }) {
      withContext(({ logger }) => {
        logger.info("test_external_plugin_prompt_created", { promptId: prompt.id, title: prompt.title });
      });
    },
    onVersionAdded({ promptId, version }) {
      withContext(({ telemetry }) => {
        telemetry.recordEvent("plugin.test-external-plugin.version_added", {
          promptId,
          semanticVersion: version.semanticVersion,
        });
      });
    },
    onPromptTagged({ promptId, tags }) {
      withContext(({ logger }) => {
        logger.info("test_external_plugin_prompt_tagged", { promptId, tags: tags.map((tag) => tag.label) });
      });
    },
    onPromptUntagged({ promptId, labels }) {
      withContext(({ telemetry }) => {
        telemetry.recordEvent("plugin.test-external-plugin.prompt_untagged", { promptId, labels: labels.join(",") });
      });
    },
  };
}

export default createTestPlugin;
