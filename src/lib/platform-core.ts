// App-local compatibility layer for Prompt Vault platform contracts.
// Nobodyworld integrations can consume these app-owned contracts through adapters.

import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

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

export interface SharedTag {
  id: string;
  name: string;
  kind: string;
  color?: string;
  description?: string;
  isArchived: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectTag {
  id: string;
  slug: string;
  label: string;
  color?: string;
}

export interface PlatformEventMap {
  "tag:created": { tag: SharedTag };
  "tag:updated": { tag: SharedTag };
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

type TagRow = {
  id: string;
  name: string;
  kind: string;
  color: string | null;
  description: string | null;
  is_archived: number;
  created_at: string;
  updated_at: string;
};

type TaggingRow = {
  id: string;
  tag_id: string;
  entity_type: string;
  entity_id: string;
  context: string;
  created_at: string;
};

const DEFAULT_TAG_COLOR = "#808080";
const PROJECT_TAG_PREFIX = "project:";
let platformDatabase: Database.Database | null = null;
let platformDatabasePath: string | null = null;

function resolvePlatformDatabasePath(): string {
  return (
    process.env.PROMPT_VAULT_TAG_DB_PATH ??
    process.env.NW_CORE_DB_PATH ??
    resolve(process.cwd(), "prompt-vault-platform.db")
  );
}

function getPlatformDatabase(): Database.Database {
  const nextPath = resolvePlatformDatabasePath();
  if (platformDatabase && platformDatabasePath === nextPath) {
    return platformDatabase;
  }

  if (platformDatabase) platformDatabase.close();
  if (nextPath !== ":memory:") mkdirSync(dirname(nextPath), { recursive: true });

  platformDatabase = new Database(nextPath);
  platformDatabasePath = nextPath;
  platformDatabase.pragma("foreign_keys = ON");
  platformDatabase.pragma("busy_timeout = 5000");
  if (nextPath !== ":memory:") platformDatabase.pragma("journal_mode = WAL");
  platformDatabase.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'label',
      color TEXT,
      description TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(name, kind)
    );
    CREATE TABLE IF NOT EXISTS taggings (
      id TEXT PRIMARY KEY,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE(tag_id, entity_type, entity_id, context)
    );
    CREATE INDEX IF NOT EXISTS idx_platform_tags_name_kind
      ON tags(name, kind);
    CREATE INDEX IF NOT EXISTS idx_platform_taggings_entity
      ON taggings(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_platform_taggings_tag
      ON taggings(tag_id);
  `);
  return platformDatabase;
}

function mapSharedTag(row: TagRow): SharedTag {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    color: row.color ?? undefined,
    description: row.description ?? undefined,
    isArchived: row.is_archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeProjectSlug(slug: string): string {
  return slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function projectTagName(slug: string): string {
  return `${PROJECT_TAG_PREFIX}${slug}`;
}

function toProjectTag(tag: SharedTag): ProjectTag {
  const slug = tag.name.startsWith(PROJECT_TAG_PREFIX)
    ? tag.name.slice(PROJECT_TAG_PREFIX.length)
    : normalizeProjectSlug(tag.name);
  return {
    id: tag.id,
    slug,
    label: tag.description ?? slug,
    color: tag.color,
  };
}

export async function createSharedTag(input: {
  name: string;
  color?: string;
  description?: string;
  kind?: string;
}): Promise<SharedTag> {
  const trimmed = input.name.trim();
  if (!trimmed) throw new Error("Tag name is required");
  const kind = input.kind ?? "label";
  const database = getPlatformDatabase();
  const existing = database
    .prepare(
      "SELECT id, name, kind, color, description, is_archived, created_at, updated_at FROM tags WHERE LOWER(name) = LOWER(?) AND kind = ? LIMIT 1",
    )
    .get(trimmed, kind) as TagRow | undefined;
  if (existing) return mapSharedTag(existing);

  const now = new Date().toISOString();
  const id = randomUUID();
  database
    .prepare(
      "INSERT INTO tags (id, name, kind, color, description, is_archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
    )
    .run(
      id,
      trimmed,
      kind,
      input.color ?? DEFAULT_TAG_COLOR,
      input.description ?? null,
      now,
      now,
    );
  const created = (await getTagById(id)) as SharedTag;
  eventBus.emit("tag:created", { tag: created });
  return created;
}

export async function getTagById(id: string): Promise<SharedTag | null> {
  const row = getPlatformDatabase()
    .prepare(
      "SELECT id, name, kind, color, description, is_archived, created_at, updated_at FROM tags WHERE id = ? LIMIT 1",
    )
    .get(id) as TagRow | undefined;
  return row ? mapSharedTag(row) : null;
}

export async function listSharedTags(): Promise<SharedTag[]> {
  const rows = getPlatformDatabase()
    .prepare(
      "SELECT id, name, kind, color, description, is_archived, created_at, updated_at FROM tags WHERE is_archived = 0 ORDER BY name COLLATE NOCASE ASC",
    )
    .all() as TagRow[];
  return rows.map(mapSharedTag);
}

export async function createProjectTag(input: {
  slug: string;
  label?: string;
  color?: string;
  description?: string;
}): Promise<ProjectTag> {
  const slug = normalizeProjectSlug(input.slug);
  if (!slug) throw new Error("Project slug is required");
  const existing = await getProjectTagBySlug(slug);
  if (existing) return existing;
  const tag = await createSharedTag({
    name: projectTagName(slug),
    kind: "project",
    color: input.color,
    description: input.label ?? input.description ?? slug,
  });
  return toProjectTag(tag);
}

export async function getProjectTagBySlug(
  slug: string,
): Promise<ProjectTag | null> {
  const normalized = normalizeProjectSlug(slug);
  if (!normalized) return null;
  const row = getPlatformDatabase()
    .prepare(
      "SELECT id, name, kind, color, description, is_archived, created_at, updated_at FROM tags WHERE name = ? AND kind = 'project' AND is_archived = 0 LIMIT 1",
    )
    .get(projectTagName(normalized)) as TagRow | undefined;
  return row ? toProjectTag(mapSharedTag(row)) : null;
}

export async function tagSharedPrompt(
  promptId: string,
  tagId: string,
): Promise<{ id: string; tagId: string; entityType: string; entityId: string }> {
  const database = getPlatformDatabase();
  const tag = await getTagById(tagId);
  if (!tag) throw new Error(`Tag not found: ${tagId}`);
  const existing = database
    .prepare(
      "SELECT id, tag_id, entity_type, entity_id, context, created_at FROM taggings WHERE tag_id = ? AND entity_type = 'prompts' AND entity_id = ? AND context = '' LIMIT 1",
    )
    .get(tagId, promptId) as TaggingRow | undefined;
  if (existing) {
    return {
      id: existing.id,
      tagId: existing.tag_id,
      entityType: existing.entity_type,
      entityId: existing.entity_id,
    };
  }

  const id = randomUUID();
  database
    .prepare(
      "INSERT INTO taggings (id, tag_id, entity_type, entity_id, context, created_at) VALUES (?, ?, 'prompts', ?, '', ?)",
    )
    .run(id, tagId, promptId, new Date().toISOString());
  return { id, tagId, entityType: "prompts", entityId: promptId };
}

export async function untagSharedPrompt(
  promptId: string,
  tagId: string,
): Promise<boolean> {
  const result = getPlatformDatabase()
    .prepare(
      "DELETE FROM taggings WHERE tag_id = ? AND entity_type = 'prompts' AND entity_id = ? AND context = ''",
    )
    .run(tagId, promptId);
  return result.changes > 0;
}

export async function listSharedTagsForEntity(input: {
  entityType: string;
  entityId: string;
}): Promise<SharedTag[]> {
  const rows = getPlatformDatabase()
    .prepare(
      `SELECT t.id, t.name, t.kind, t.color, t.description, t.is_archived, t.created_at, t.updated_at
       FROM taggings tg
       JOIN tags t ON t.id = tg.tag_id
       WHERE tg.entity_type = ? AND tg.entity_id = ? AND t.is_archived = 0
       ORDER BY t.name COLLATE NOCASE ASC`,
    )
    .all(input.entityType, input.entityId) as TagRow[];
  return rows.map(mapSharedTag);
}

export async function listSharedEntitiesByTags(input: {
  entityType: string;
  tagIds: string[];
  match?: "any" | "all";
}): Promise<string[]> {
  if (input.tagIds.length === 0) return [];
  const placeholders = input.tagIds.map(() => "?").join(", ");
  const match = input.match ?? "any";
  const base = `SELECT entity_id, COUNT(DISTINCT tag_id) AS tag_count
    FROM taggings
    WHERE entity_type = ? AND tag_id IN (${placeholders})
    GROUP BY entity_id`;
  const sql =
    match === "all" ? `${base} HAVING tag_count = ?` : `${base} HAVING tag_count > 0`;
  const params: Array<string | number> = [input.entityType, ...input.tagIds];
  if (match === "all") params.push(input.tagIds.length);
  const rows = getPlatformDatabase().prepare(sql).all(...params) as Array<{
    entity_id: string;
  }>;
  return rows.map((row) => row.entity_id);
}

export async function resetCoreDb(): Promise<void> {
  if (platformDatabase) platformDatabase.close();
  platformDatabase = null;
  platformDatabasePath = null;
  localApiKeys.clear();
}
