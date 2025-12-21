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

export type { PlatformEventMap } from "@nw/event-bus";

type CreateLoggerFn = (typeof import("@nw/logging"))["createLogger"];
type GetEventBusFn = (typeof import("@nw/event-bus"))["getEventBus"];
type RegisterWidgetsFn = (typeof import("@nw/pages-widgets"))["registerWidgets"];

type ResetCoreDbFn = (typeof import("@nw/core-db"))["resetCoreDb"];
type VerifyCoreDbApiKeyFn = (typeof import("@nw/core-db"))["verifyCoreDbApiKey"];
type VerifyCoreDbSessionTokenFn = (typeof import("@nw/core-db"))["verifyCoreDbSessionToken"];

type CreateProjectTagFn = (typeof import("@nw/tags-projects"))["createProjectTag"];
type GetProjectTagBySlugFn = (typeof import("@nw/tags-projects"))["getProjectTagBySlug"];
type CreateSharedTagFn = (typeof import("@nw/tags-projects"))["createTag"];
type GetTagByIdFn = (typeof import("@nw/tags-projects"))["getTagById"];
type ListSharedTagsFn = (typeof import("@nw/tags-projects"))["listTags"];
type ListSharedTagsForEntityFn = (typeof import("@nw/tags-projects"))["listTagsForEntity"];
type TagSharedPromptFn = (typeof import("@nw/tags-projects"))["tagPrompt"];
type UntagSharedPromptFn = (typeof import("@nw/tags-projects"))["untagPrompt"];
type ListSharedEntitiesByTagsFn = (typeof import("@nw/tags-projects"))["listEntitiesByTags"];

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
