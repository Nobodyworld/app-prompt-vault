// App-local compatibility layer for Prompt Vault platform contracts.
// The remaining direct @nw/* import is isolated here until shared tags are optional.

import { createHash } from "node:crypto";
import * as tagsProjectsModule from "@nw/tags-projects";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
}

export interface PlatformEventMap {
  "tag:created": { tag: { id: string | number; [key: string]: unknown } };
  "tag:updated": { tag: { id: string | number; [key: string]: unknown } };
  "tag:deleted": { tagId: string | number };
  "pv:prompt_created": {
    promptId: string;
    actorUserId?: string;
    requestId?: string;
  };
  "pv:prompt_updated": {
    promptId: string;
    actorUserId?: string;
    requestId?: string;
  };
  "pv:prompt_deleted": {
    promptId: string;
    actorUserId?: string;
    requestId?: string;
  };
  "logging:log_entry": LogEntry;
}

type EventKey = Extract<keyof PlatformEventMap, string>;
type EventListener<K extends EventKey> = (payload: PlatformEventMap[K]) => void;
type AnyEventListener = (payload: unknown) => void;

class PromptVaultEventBus {
  private readonly listeners = new Map<EventKey, Set<AnyEventListener>>();

  on<K extends EventKey>(event: K, listener: EventListener<K>): () => void {
    const listeners = this.listeners.get(event) ?? new Set<AnyEventListener>();
    listeners.add(listener as AnyEventListener);
    this.listeners.set(event, listeners);
    return () => this.off(event, listener);
  }

  off<K extends EventKey>(event: K, listener: EventListener<K>): void {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    listeners.delete(listener as AnyEventListener);
    if (listeners.size === 0) this.listeners.delete(event);
  }

  emit<K extends EventKey>(event: K, payload: PlatformEventMap[K]): void {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    for (const listener of [...listeners]) listener(payload);
  }
}

const eventBus = new PromptVaultEventBus();

export function getEventBus(): PromptVaultEventBus {
  return eventBus;
}

const DEFAULT_LOG_BUFFER_LIMIT = 500;
const logBuffer: LogEntry[] = [];
const levelWeights: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function getRecentLogs(
  limit = 100,
  levels?: LogLevel | LogLevel[],
): LogEntry[] {
  if (limit <= 0) return [];
  const allowed = levels
    ? new Set(Array.isArray(levels) ? levels : [levels])
    : undefined;
  const filtered = allowed
    ? logBuffer.filter((entry) => allowed.has(entry.level))
    : logBuffer;
  return filtered.slice(0, Math.min(limit, DEFAULT_LOG_BUFFER_LIMIT));
}

export function createLogger(options: {
  context?: Record<string, unknown>;
  level?: LogLevel;
  sinks?: Array<(entry: LogEntry) => void>;
} = {}): Logger {
  const context = options.context ?? {};
  const threshold = options.level ?? "debug";
  const sinks = options.sinks ?? [];

  const emit = (
    level: LogLevel,
    message: string,
    meta: Record<string, unknown> = {},
  ): void => {
    if (levelWeights[level] < levelWeights[threshold]) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { ...context },
      meta: { ...meta },
    };

    logBuffer.unshift(entry);
    if (logBuffer.length > DEFAULT_LOG_BUFFER_LIMIT) {
      logBuffer.length = DEFAULT_LOG_BUFFER_LIMIT;
    }

    console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
      `[${level.toUpperCase()}] ${message}`,
      entry,
    );
    eventBus.emit("logging:log_entry", entry);

    for (const sink of sinks) {
      try {
        sink(entry);
      } catch (error) {
        console.warn("Log sink error", error);
      }
    }
  };

  return {
    info: (message, meta) => emit("info", message, meta),
    error: (message, meta) => emit("error", message, meta),
    warn: (message, meta) => emit("warn", message, meta),
    debug: (message, meta) => emit("debug", message, meta),
    child: (childContext) =>
      createLogger({
        ...options,
        context: { ...context, ...childContext },
      }),
  };
}

const localSecretStore = new Map<string, string>();

function insecureSecretFallbackAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.NW_SECRETS_ALLOW_INSECURE === "1" ||
    process.env.NW_SECRETS_ALLOW_INSECURE === "true"
  );
}

/**
 * Process-local fallback used only when JWT_SECRET is not injected.
 * Production refuses this fallback unless explicitly overridden.
 */
export async function getSecret(ref: string): Promise<string | null> {
  return localSecretStore.get(ref) ?? null;
}

export async function storeSecret(ref: string, value: string): Promise<void> {
  if (!insecureSecretFallbackAllowed()) {
    throw new Error(
      "Secure secret persistence is unavailable in production. Set JWT_SECRET or explicitly set NW_SECRETS_ALLOW_INSECURE=1 for emergency diagnostics.",
    );
  }
  localSecretStore.set(ref, value);
}

export type CoreDbAuthKind = "api-key" | "session";

export interface CoreDbAuthContext {
  kind: CoreDbAuthKind;
  userId: string;
  displayName?: string;
  roles: string[];
  scopes: string[];
  apiKeyId?: string;
  sessionId?: string;
}

export interface CoreDbAuthRequirements {
  roles?: string[];
  scopes?: string[];
}

type LocalApiKeyRecord = {
  id: string;
  hash: string;
  context: CoreDbAuthContext;
};

const localApiKeys = new Map<string, LocalApiKeyRecord>();

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function scopeAllows(granted: string, required: string): boolean {
  if (granted === "*" || granted === required) return true;
  return granted.endsWith("*") && required.startsWith(granted.slice(0, -1));
}

function meetsAuthRequirements(
  context: CoreDbAuthContext,
  requirements: CoreDbAuthRequirements,
): boolean {
  const requiredRoles = requirements.roles ?? [];
  const requiredScopes = requirements.scopes ?? [];
  const roleAllowed =
    requiredRoles.length === 0 ||
    requiredRoles.some((role) => context.roles.includes(role));
  const scopesAllowed = requiredScopes.every((required) =>
    context.scopes.some((granted) => scopeAllows(granted, required)),
  );
  return roleAllowed && scopesAllowed;
}

/** Seed the standalone auth compatibility store from environment API keys. */
export async function bootstrapCoreDbAuthFromApiKeys(
  apiKeys: Record<string, string>,
  options: {
    ownerUserId?: string;
    ownerDisplayName?: string;
    scopes?: string[];
    idPrefix?: string;
  } = {},
): Promise<{ ownerUserId: string; apiKeyIds: string[] }> {
  const ownerUserId = options.ownerUserId ?? "user-owner";
  const displayName = options.ownerDisplayName ?? "Owner";
  const scopes = options.scopes ?? ["*"];
  const idPrefix = options.idPrefix ?? "env";
  const apiKeyIds: string[] = [];

  for (const [name, value] of Object.entries(apiKeys)) {
    if (!value) continue;
    const id = `apikey-${idPrefix}-${name}`;
    const hash = sha256(value);
    localApiKeys.set(hash, {
      id,
      hash,
      context: {
        kind: "api-key",
        userId: ownerUserId,
        displayName,
        roles: ["owner"],
        scopes: [...scopes],
        apiKeyId: id,
      },
    });
    apiKeyIds.push(id);
  }

  return { ownerUserId, apiKeyIds };
}

export async function verifyCoreDbApiKey(
  presentedKey: string | undefined,
  requirements: CoreDbAuthRequirements = {},
): Promise<CoreDbAuthContext | null> {
  if (!presentedKey) return null;
  const record = localApiKeys.get(sha256(presentedKey));
  if (!record || !meetsAuthRequirements(record.context, requirements)) return null;
  return {
    ...record.context,
    roles: [...record.context.roles],
    scopes: [...record.context.scopes],
  };
}

/**
 * Standalone Prompt Vault issues and validates its own JWTs in AuthManager.
 * Shared Core DB session tokens are intentionally unavailable without an adapter.
 */
export async function verifyCoreDbSessionToken(
  _token: string | undefined,
  _secret: string | undefined,
  _requirements: CoreDbAuthRequirements = {},
): Promise<CoreDbAuthContext | null> {
  return null;
}

export async function resetCoreDb(): Promise<void> {
  localApiKeys.clear();
}

export interface IntegrityCheckResult {
  isValid: boolean;
  expectedChecksum: string;
  actualChecksum: string;
  data: string;
}

export function generateIntegrityChecksum(data: string): string {
  return sha256(data);
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

type CreateProjectTagFn = typeof tagsProjectsModule.createProjectTag;
type GetProjectTagBySlugFn = typeof tagsProjectsModule.getProjectTagBySlug;
type CreateSharedTagFn = typeof tagsProjectsModule.createTag;
type GetTagByIdFn = typeof tagsProjectsModule.getTagById;
type ListSharedTagsFn = typeof tagsProjectsModule.listTags;
type ListSharedTagsForEntityFn = typeof tagsProjectsModule.listTagsForEntity;
type TagSharedPromptFn = typeof tagsProjectsModule.tagPrompt;
type UntagSharedPromptFn = typeof tagsProjectsModule.untagPrompt;
type ListSharedEntitiesByTagsFn = typeof tagsProjectsModule.listEntitiesByTags;

type ModuleWithDefault<T> = T & { default?: T };

function pickFunction<T extends object, K extends keyof any>(
  mod: ModuleWithDefault<T>,
  key: K,
  label: string,
): (...args: any[]) => any {
  return (...args: any[]) => {
    const candidate = (mod as any)[key] ?? (mod as any).default?.[key];
    if (typeof candidate !== "function") {
      throw new Error(
        `${label} does not provide a callable export named '${String(key)}'`,
      );
    }
    return (candidate as (...inner: any[]) => any)(...args);
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
