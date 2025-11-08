import type { PromptVaultPlugin } from "../src/extensions/types.js";

export function createTestPlugin(): PromptVaultPlugin {
  return {
    name: "test-external-plugin",
    version: "1.0.0",
    description: "A test external plugin for demonstration",
    setup({ logger, telemetry }) {
      logger.info("test_external_plugin_ready");
      telemetry.recordEvent("plugin.test-external-plugin.setup");
    },
    onPromptCreated({ prompt }) {
      console.log(`[TEST PLUGIN] New prompt created: ${prompt.title}`);
    },
  };
}

export default createTestPlugin;
