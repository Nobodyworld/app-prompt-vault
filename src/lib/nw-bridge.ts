/**
 * NW Bridge - Integration layer between Prompt Vault and @nw/* shared packages
 *
 * This module provides adapters to bridge Prompt Vault's domain models
 * with the shared Nobodyworld OS packages.
 */

import { createLogger } from '@nw/logging';
import { getEventBus } from '@nw/event-bus';
import type { Tag as NwTag } from '@nw/tags-projects';
import type { Tag as PvTag } from '../domain/models.js';

// Create a logger for Prompt Vault operations
export const pvLogger = createLogger({
    context: {
        app: 'prompt-vault',
        package: 'nw-bridge',
    },
});

// Get the shared event bus
export const eventBus: ReturnType<typeof getEventBus> = getEventBus();

/**
 * Convert a Prompt Vault Tag to the shared NW Tag format
 *
 * Note: PV Tags use string UUIDs, NW Tags use numeric IDs.
 * This adapter creates a bridge but the underlying storage remains separate.
 */
export function pvTagToNwTag(pvTag: PvTag): Omit<NwTag, 'id'> & { id: string } {
    return {
        id: pvTag.id, // Keep as string - apps can use their own ID scheme
        name: pvTag.label,
        kind: 'label',
        color: '#6366f1', // Default color - PV tags don't have color
        description: pvTag.description,
        isArchived: false,
        createdAt: pvTag.createdAt.toISOString(),
        updatedAt: pvTag.createdAt.toISOString(),
    };
}

/**
 * Convert an NW Tag to Prompt Vault Tag format
 */
export function nwTagToPvTag(nwTag: NwTag): PvTag {
    return {
        id: String(nwTag.id),
        label: nwTag.name,
        description: undefined,
        createdAt: new Date(nwTag.createdAt ?? Date.now()),
    };
}

/**
 * Subscribe to cross-app tag events
 *
 * This allows Prompt Vault to react to tag changes from other apps
 */
export function subscribeToTagEvents(handlers: {
    onTagCreated?: (tag: NwTag) => void;
    onTagUpdated?: (tag: NwTag) => void;
    onTagDeleted?: (tagId: number) => void;
}): () => void {
    const subscriptions: Array<() => void> = [];

    if (handlers.onTagCreated) {
        const unsubscribe = eventBus.on('tag:created', (data: { tag: NwTag }) => {
            const tag = data.tag;
            pvLogger.info('External tag created', { tagId: tag.id });
            const fullTag: NwTag = {
                ...tag,
                createdAt: (tag as any).createdAt ?? new Date().toISOString(),
                updatedAt: (tag as any).updatedAt ?? new Date().toISOString(),
            };
            handlers.onTagCreated!(fullTag);
        });
        subscriptions.push(unsubscribe);
    }

    if (handlers.onTagUpdated) {
        const unsubscribe = eventBus.on('tag:updated', (data: { tag: NwTag }) => {
            const tag = data.tag;
            pvLogger.info('External tag updated', { tagId: tag.id });
            const fullTag: NwTag = {
                ...tag,
                createdAt: (tag as any).createdAt ?? new Date().toISOString(),
                updatedAt: (tag as any).updatedAt ?? new Date().toISOString(),
            };
            handlers.onTagUpdated!(fullTag);
        });
        subscriptions.push(unsubscribe);
    }

    if (handlers.onTagDeleted) {
        const unsubscribe = eventBus.on('tag:deleted', (data: { tagId: number }) => {
            pvLogger.info('External tag deleted', { tagId: data.tagId });
            handlers.onTagDeleted!(data.tagId);
        });
        subscriptions.push(unsubscribe);
    }

    // Return cleanup function
    return () => {
        subscriptions.forEach((unsubscribe) => unsubscribe());
    };
}

/**
 * Emit Prompt Vault events to the shared event bus
 */
export function emitPromptEvent(
    type: 'pv:prompt_created' | 'pv:prompt_updated' | 'pv:prompt_deleted',
    data: { promptId: string }
): void {
    pvLogger.debug('Emitting prompt event', { type, promptId: data.promptId });
    eventBus.emit(type, data);
}

/**
 * Log levels exposed for app configuration
 */
/**
 * Initialize all Prompt Vault integrations with the NW platform
 *
 * Call this at app startup to register tools with the orchestrator
 */
export async function initializeNwIntegrations(): Promise<void> {
    pvLogger.info('Initializing NW integrations');

    // Dynamically import tools to avoid circular dependencies
    try {
        const { registerPromptVaultTools } = await import('../tools/index.js');
        registerPromptVaultTools();
        pvLogger.info('Prompt Vault tools registered with orchestrator');
    } catch (error) {
        pvLogger.warn('Failed to register orchestrator tools', { error });
    }

    // Register Prompt Vault widgets with the shared pages-widgets registry
    try {
        const { registerWidgets } = await import('@nw/pages-widgets');
        registerWidgets([
            {
                id: 'prompt-vault.quick-add',
                appId: 'prompt-vault',
                displayName: 'Quick Add Prompt',
                description: 'Create a new prompt in the current project',
                icon: 'plus',
            },
            {
                id: 'prompt-vault.recent',
                appId: 'prompt-vault',
                displayName: 'Recent Prompts',
                description: 'Recently created or edited prompts',
                icon: 'clock',
            },
        ]);
        pvLogger.info('Prompt Vault widgets registered with pages-widgets');
    } catch (error) {
        pvLogger.warn('Failed to register Prompt Vault widgets', { error });
    }
}

// Re-export tools module for direct access
export * from '../tools/index.js';
