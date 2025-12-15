// App-local adapter for @nw/* imports.
// Keep direct @nw/* imports out of app code per repo conventions.

export { createLogger } from '@nw/logging';
export { getEventBus, type PlatformEventMap } from '@nw/event-bus';
export { registerWidgets } from '@nw/pages-widgets';
export { getSecret, storeSecret } from '@nw/secrets';

export {
    resetCoreDb,
    generateIntegrityChecksum,
    checkDataIntegrity,
    verifyCoreDbApiKey,
    verifyCoreDbSessionToken,
    type CoreDbAuthContext,
} from '@nw/core-db';

export { createProjectTag, getProjectTagBySlug } from '@nw/tags-projects';

export {
    createTag as createSharedTag,
    getTagById,
    listTags as listSharedTags,
    listTagsForEntity as listSharedTagsForEntity,
    tagPrompt as tagSharedPrompt,
    untagPrompt as untagSharedPrompt,
    listEntitiesByTags as listSharedEntitiesByTags,
    type Tag as SharedTag,
} from '@nw/tags-projects';
