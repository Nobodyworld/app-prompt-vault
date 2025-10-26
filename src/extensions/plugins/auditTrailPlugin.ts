import type { PromptVaultPlugin, PromptVaultPluginContext } from "../types.js";

export function createAuditTrailPlugin(): PromptVaultPlugin {
  let context: PromptVaultPluginContext | undefined;

  return {
    name: "audit-trail",
    setup(pluginContext) {
      context = pluginContext;
      context.logger.info("audit_trail_plugin_ready");
    },
    onPromptCreated({ prompt, version }) {
      context?.logger.info("audit_prompt_created", {
        promptId: prompt.id,
        slug: prompt.slug,
        version: version.semanticVersion,
      });
      context?.telemetry.recordEvent("audit.prompt_created", { promptId: prompt.id });
    },
    onVersionAdded({ promptId, version }) {
      context?.logger.info("audit_version_added", {
        promptId,
        version: version.semanticVersion,
      });
    },
    onPromptTagged({ promptId, tags }) {
      context?.logger.info("audit_prompt_tagged", {
        promptId,
        tags: tags.map((tag) => tag.label).join(","),
      });
    },
  };
}
