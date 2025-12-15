// App-local adapter for @nw/* imports.
// Keep direct @nw/* imports out of app code per repo conventions.

export { createLogger } from '@nw/logging';
export { getEventBus, type PlatformEventMap } from '@nw/event-bus';
export { registerWidgets } from '@nw/pages-widgets';
export { resetCoreDb } from '@nw/core-db';

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
