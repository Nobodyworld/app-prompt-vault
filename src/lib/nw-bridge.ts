/**
 * Prompt Vault compatibility bridge.
 *
 * The historical filename and exported function names are retained for existing
 * callers. The implementation now uses app-owned logging, events, tags, tool
 * registration, and widget registration. Optional external adapters may consume
 * these contracts without becoming Prompt Vault installation dependencies.
 */

import {
  createLogger,
  getEventBus,
  type PlatformEventMap,
  type SharedTag as NwTag,
} from "./platform-core.js";
import type { Tag as PvTag } from "../domain/models.js";

export const pvLogger = createLogger({
  context: {
    app: "prompt-vault",
    package: "compatibility-bridge",
  },
});

export const eventBus: ReturnType<typeof getEventBus> = getEventBus();

/** Convert a Prompt Vault domain tag to the app-owned shared-tag contract. */
export function pvTagToNwTag(pvTag: PvTag): Omit<NwTag, "id"> & { id: string } {
  return {
    id: pvTag.id,
    name: pvTag.label,
    kind: "label",
    color: "#6366f1",
    description: pvTag.description,
    isArchived: false,
    createdAt: pvTag.createdAt.toISOString(),
    updatedAt: pvTag.createdAt.toISOString(),
  };
}

/** Convert the app-owned shared-tag contract to a Prompt Vault domain tag. */
export function nwTagToPvTag(nwTag: NwTag): PvTag {
  return {
    id: String(nwTag.id),
    label: nwTag.name,
    description: nwTag.description,
    createdAt: new Date(nwTag.createdAt ?? Date.now()),
  };
}

/** Subscribe to tag events emitted through Prompt Vault's local event bus. */
export function subscribeToTagEvents(handlers: {
  onTagCreated?: (tag: NwTag) => void;
  onTagUpdated?: (tag: NwTag) => void;
  onTagDeleted?: (tagId: string | number) => void;
}): () => void {
  const subscriptions: Array<() => void> = [];

  if (handlers.onTagCreated) {
    const unsubscribe = eventBus.on(
      "tag:created",
      (data: PlatformEventMap["tag:created"]) => {
        const tag = data.tag;
        pvLogger.info("Tag created", { tagId: tag.id });
        const fallbackTimestamp = new Date().toISOString();
        handlers.onTagCreated?.({
          ...tag,
          createdAt: tag.createdAt ?? fallbackTimestamp,
          updatedAt: tag.updatedAt ?? fallbackTimestamp,
        });
      },
    );
    subscriptions.push(unsubscribe);
  }

  if (handlers.onTagUpdated) {
    const unsubscribe = eventBus.on(
      "tag:updated",
      (data: PlatformEventMap["tag:updated"]) => {
        const tag = data.tag;
        pvLogger.info("Tag updated", { tagId: tag.id });
        const fallbackTimestamp = new Date().toISOString();
        handlers.onTagUpdated?.({
          ...tag,
          createdAt: tag.createdAt ?? fallbackTimestamp,
          updatedAt: tag.updatedAt ?? fallbackTimestamp,
        });
      },
    );
    subscriptions.push(unsubscribe);
  }

  if (handlers.onTagDeleted) {
    const unsubscribe = eventBus.on(
      "tag:deleted",
      (data: PlatformEventMap["tag:deleted"]) => {
        pvLogger.info("Tag deleted", { tagId: data.tagId });
        handlers.onTagDeleted?.(data.tagId);
      },
    );
    subscriptions.push(unsubscribe);
  }

  return () => {
    subscriptions.forEach((unsubscribe) => unsubscribe());
  };
}

/** Emit a minimal Prompt Vault lifecycle event without prompt content. */
export function emitPromptEvent(
  type: "pv:prompt_created" | "pv:prompt_updated" | "pv:prompt_deleted",
  data: { promptId: string; actorUserId?: string; requestId?: string },
): void {
  pvLogger.debug("Emitting prompt event", { type, promptId: data.promptId });
  eventBus.emit(type, data);
}

/**
 * Register Prompt Vault's app-local tools and widgets.
 *
 * The legacy function name is retained for compatibility. External platforms
 * should consume the resulting registries through explicit optional adapters.
 */
export async function initializeNwIntegrations(): Promise<void> {
  pvLogger.info("Initializing Prompt Vault registries");

  try {
    const { registerPromptVaultTools } = await import("../tools/index.js");
    registerPromptVaultTools();
    pvLogger.info("Prompt Vault tools registered locally");
  } catch (error) {
    pvLogger.warn("Failed to register Prompt Vault tools", { error });
  }

  try {
    const { registerPromptVaultWidgetsWithPagesWidgets } = await import(
      "../widgets/register.js"
    );
    registerPromptVaultWidgetsWithPagesWidgets();
    pvLogger.info("Prompt Vault widgets registered locally");
  } catch (error) {
    pvLogger.warn("Failed to register Prompt Vault widgets", { error });
  }
}

export * from "../tools/index.js";
