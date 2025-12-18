// App-local adapter for @nw/* imports.
// Keep direct @nw/* imports out of app code per repo conventions.

import { createHash } from "node:crypto";
import type { IntegrityCheckResult } from "@nw/core-db";

export { createLogger } from "@nw/logging";
export { getEventBus, type PlatformEventMap } from "@nw/event-bus";
export { registerWidgets } from "@nw/pages-widgets";
export { getSecret, storeSecret } from "@nw/secrets";

export {
  resetCoreDb,
  verifyCoreDbApiKey,
  verifyCoreDbSessionToken,
  type CoreDbAuthContext,
} from "@nw/core-db";

// NOTE: @nw/core-db exposes async WebCrypto-based integrity helpers. Prompt Vault
// repository code is intentionally synchronous (better-sqlite3 transactions), so
// we provide node-only sync wrappers here.
export function generateIntegrityChecksum(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function checkDataIntegrity(
  data: string,
  expectedChecksum: string,
): IntegrityCheckResult {
  const actualChecksum = generateIntegrityChecksum(data);
  return {
    isValid: actualChecksum === expectedChecksum,
    expectedChecksum,
    actualChecksum,
    data,
  };
}

export { createProjectTag, getProjectTagBySlug } from "@nw/tags-projects";

export {
  createTag as createSharedTag,
  getTagById,
  listTags as listSharedTags,
  listTagsForEntity as listSharedTagsForEntity,
  tagPrompt as tagSharedPrompt,
  untagPrompt as untagSharedPrompt,
  listEntitiesByTags as listSharedEntitiesByTags,
  type Tag as SharedTag,
} from "@nw/tags-projects";
