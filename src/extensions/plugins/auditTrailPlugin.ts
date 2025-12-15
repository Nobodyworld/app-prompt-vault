import type { PromptVaultPlugin, PromptVaultPluginContext } from "../types.js";

export function createAuditTrailPlugin(): PromptVaultPlugin {
  let context: PromptVaultPluginContext | undefined;

  return {
    name: "audit-trail",
    setup(pluginContext) {
      context = pluginContext;
      context.logger.info("audit_trail_plugin_ready");
    },
    onPromptCreated({ prompt, version, actor }) {
      context?.logger.info("audit_prompt_created", {
        promptId: prompt.id,
        slug: prompt.slug,
        version: version.semanticVersion,
        actorUserId: actor?.userId,
        requestId: actor?.requestId,
      });
      context?.telemetry.recordEvent("audit.prompt_created", {
        promptId: prompt.id,
        actorUserId: actor?.userId,
        requestId: actor?.requestId,
      });
    },
    onPromptUpdated({ prompt, updatedFields, actor }) {
      context?.logger.info("audit_prompt_updated", {
        promptId: prompt.id,
        slug: prompt.slug,
        updatedFields,
        actorUserId: actor?.userId,
        requestId: actor?.requestId,
      });
      context?.telemetry.recordEvent("audit.prompt_updated", {
        promptId: prompt.id,
        updatedFields: updatedFields.join(","),
        actorUserId: actor?.userId,
        requestId: actor?.requestId,
      });
    },
    onPromptDeleted({ promptId, mode, actor }) {
      context?.logger.info("audit_prompt_deleted", {
        promptId,
        mode,
        actorUserId: actor?.userId,
        requestId: actor?.requestId,
      });
      context?.telemetry.recordEvent("audit.prompt_deleted", {
        promptId,
        mode,
        actorUserId: actor?.userId,
        requestId: actor?.requestId,
      });
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
    onPromptUntagged({ promptId, labels }) {
      context?.logger.info("audit_prompt_untagged", {
        promptId,
        labels: labels.join(","),
      });
    },
  };
}
