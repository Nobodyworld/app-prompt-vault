/**
 * NW Bridge - Integration layer between Prompt Vault and @nw/* shared packages
 *
 * This module provides adapters to bridge Prompt Vault's domain models
 * with the shared Nobodyworld OS packages.
 */

import { createLogger, type LogLevel } from '@nw/logging';
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
export const eventBus = getEventBus();

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
        color: '#6366f1', // Default color - PV tags don't have color
        isProject: false, // PV doesn't have project concept yet
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
        createdAt: new Date(nwTag.createdAt),
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
    const subscriptions: Array<{ unsubscribe: () => void }> = [];

    if (handlers.onTagCreated) {
        subscriptions.push(
            eventBus.on('tag:created', (data) => {
                pvLogger.info('External tag created', { tagId: data.tag.id });
                // Create a complete NwTag with required fields
                const fullTag: NwTag = {
                    ...data.tag,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };
                handlers.onTagCreated!(fullTag);
            })
        );
    }

    if (handlers.onTagUpdated) {
        subscriptions.push(
            eventBus.on('tag:updated', (data) => {
                pvLogger.info('External tag updated', { tagId: data.tag.id });
                const fullTag: NwTag = {
                    ...data.tag,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };
                handlers.onTagUpdated!(fullTag);
            })
        );
    }

    if (handlers.onTagDeleted) {
        subscriptions.push(
            eventBus.on('tag:deleted', (data) => {
                pvLogger.info('External tag deleted', { tagId: data.tagId });
                handlers.onTagDeleted!(data.tagId);
            })
        );
    }

    // Return cleanup function
    return () => {
        subscriptions.forEach((sub) => sub.unsubscribe());
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
export { type LogLevel };

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
}

// Re-export tools module for direct access
export * from '../tools/index.js';
