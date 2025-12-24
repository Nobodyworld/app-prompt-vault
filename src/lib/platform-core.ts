// App-local adapter for @nw/* imports.
// Keep direct @nw/* imports out of app code per repo conventions.

import { createHash } from "node:crypto";
import type { IntegrityCheckResult } from "@nw/core-db";
import * as secretsModule from "@nw/secrets";
import * as loggingModule from "@nw/logging";
import * as eventBusModule from "@nw/event-bus";
import * as pagesWidgetsModule from "@nw/pages-widgets";
import * as coreDbModule from "@nw/core-db";
import * as tagsProjectsModule from "@nw/tags-projects";

export type { LogEntry, LogLevel } from "@nw/logging";

export type { PlatformEventMap } from "@nw/event-bus";

type CreateLoggerFn = typeof loggingModule.createLogger;
type GetRecentLogsFn = typeof loggingModule.getRecentLogs;
type GetEventBusFn = typeof eventBusModule.getEventBus;
type RegisterWidgetsFn = typeof pagesWidgetsModule.registerWidgets;

type ResetCoreDbFn = typeof coreDbModule.resetCoreDb;
type VerifyCoreDbApiKeyFn = typeof coreDbModule.verifyCoreDbApiKey;
type VerifyCoreDbSessionTokenFn = typeof coreDbModule.verifyCoreDbSessionToken;
type BootstrapCoreDbAuthFromApiKeysFn = typeof coreDbModule.bootstrapCoreDbAuthFromApiKeys;

type CreateProjectTagFn = typeof tagsProjectsModule.createProjectTag;
type GetProjectTagBySlugFn = typeof tagsProjectsModule.getProjectTagBySlug;
type CreateSharedTagFn = typeof tagsProjectsModule.createTag;
type GetTagByIdFn = typeof tagsProjectsModule.getTagById;
type ListSharedTagsFn = typeof tagsProjectsModule.listTags;
type ListSharedTagsForEntityFn = typeof tagsProjectsModule.listTagsForEntity;
type TagSharedPromptFn = typeof tagsProjectsModule.tagPrompt;
type UntagSharedPromptFn = typeof tagsProjectsModule.untagPrompt;
type ListSharedEntitiesByTagsFn = typeof tagsProjectsModule.listEntitiesByTags;

type SecretsModuleShape = {
  getSecret?: (...args: any[]) => any;
  storeSecret?: (...args: any[]) => any;
  default?: {
    getSecret?: (...args: any[]) => any;
    storeSecret?: (...args: any[]) => any;
  };
};

const secretsCompat = secretsModule as unknown as SecretsModuleShape;

type ModuleWithDefault<T> = T & { default?: T };

function pickFunction<T extends object, K extends keyof any>(
  mod: ModuleWithDefault<T>,
  key: K,
  label: string,
): (...args: any[]) => any {
  return (...args: any[]) => {
    let candidate: unknown;
    try {
      candidate = (mod as any)[key] ?? (mod as any).default?.[key];
    } catch {
      candidate = undefined;
    }

    if (typeof candidate !== "function") {
      throw new Error(`${label} does not provide a callable export named '${String(key)}'`);
    }

    return (candidate as (...inner: any[]) => any)(...args);
  };
}

export const createLogger = pickFunction(
  loggingModule as any,
  "createLogger",
  "@nw/logging",
) as unknown as CreateLoggerFn;

export const getRecentLogs = pickFunction(
  loggingModule as any,
  "getRecentLogs",
  "@nw/logging",
) as unknown as GetRecentLogsFn;

export const getEventBus = pickFunction(
  eventBusModule as any,
  "getEventBus",
  "@nw/event-bus",
) as unknown as GetEventBusFn;

export const registerWidgets = pickFunction(
  pagesWidgetsModule as any,
  "registerWidgets",
  "@nw/pages-widgets",
) as unknown as RegisterWidgetsFn;

export async function getSecret(
  ref: string,
  options?: unknown,
): Promise<string | null> {
  const fn = secretsCompat.getSecret ?? secretsCompat.default?.getSecret;
  if (typeof fn !== "function") {
    throw new Error("[@nw/secrets] getSecret is not available in this runtime");
  }
  return fn(ref, options);
}

export async function storeSecret(
  ref: string,
  value: string,
  options?: unknown,
): Promise<void> {
  const fn = secretsCompat.storeSecret ?? secretsCompat.default?.storeSecret;
  if (typeof fn !== "function") {
    throw new Error("[@nw/secrets] storeSecret is not available in this runtime");
  }
  await fn(ref, value, options);
}

export type { CoreDbAuthContext } from "@nw/core-db";

export const resetCoreDb = pickFunction(
  coreDbModule as any,
  "resetCoreDb",
  "@nw/core-db",
) as unknown as ResetCoreDbFn;

export const verifyCoreDbApiKey = pickFunction(
  coreDbModule as any,
  "verifyCoreDbApiKey",
  "@nw/core-db",
) as unknown as VerifyCoreDbApiKeyFn;

export const verifyCoreDbSessionToken = pickFunction(
  coreDbModule as any,
  "verifyCoreDbSessionToken",
  "@nw/core-db",
) as unknown as VerifyCoreDbSessionTokenFn;

export const bootstrapCoreDbAuthFromApiKeys = pickFunction(
  coreDbModule as any,
  "bootstrapCoreDbAuthFromApiKeys",
  "@nw/core-db",
) as unknown as BootstrapCoreDbAuthFromApiKeysFn;

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

export const createProjectTag = pickFunction(
  tagsProjectsModule as any,
  "createProjectTag",
  "@nw/tags-projects",
) as unknown as CreateProjectTagFn;

export const getProjectTagBySlug = pickFunction(
  tagsProjectsModule as any,
  "getProjectTagBySlug",
  "@nw/tags-projects",
) as unknown as GetProjectTagBySlugFn;

export type { Tag as SharedTag } from "@nw/tags-projects";

export const createSharedTag = pickFunction(
  tagsProjectsModule as any,
  "createTag",
  "@nw/tags-projects",
) as unknown as CreateSharedTagFn;

export const getTagById = pickFunction(
  tagsProjectsModule as any,
  "getTagById",
  "@nw/tags-projects",
) as unknown as GetTagByIdFn;

export const listSharedTags = pickFunction(
  tagsProjectsModule as any,
  "listTags",
  "@nw/tags-projects",
) as unknown as ListSharedTagsFn;

export const listSharedTagsForEntity = pickFunction(
  tagsProjectsModule as any,
  "listTagsForEntity",
  "@nw/tags-projects",
) as unknown as ListSharedTagsForEntityFn;

export const tagSharedPrompt = pickFunction(
  tagsProjectsModule as any,
  "tagPrompt",
  "@nw/tags-projects",
) as unknown as TagSharedPromptFn;

export const untagSharedPrompt = pickFunction(
  tagsProjectsModule as any,
  "untagPrompt",
  "@nw/tags-projects",
) as unknown as UntagSharedPromptFn;

export const listSharedEntitiesByTags = pickFunction(
  tagsProjectsModule as any,
  "listEntitiesByTags",
  "@nw/tags-projects",
) as unknown as ListSharedEntitiesByTagsFn;
