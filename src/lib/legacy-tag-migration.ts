import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface LegacyTagMigrationOptions {
  sourcePath: string;
  targetPath: string;
  dryRun?: boolean;
}

export interface LegacyTagMigrationResult {
  sourcePath: string;
  targetPath: string;
  dryRun: boolean;
  sourceTags: number;
  sourceTaggings: number;
  insertedTags: number;
  updatedTags: number;
  reusedTags: number;
  insertedTaggings: number;
  skippedTaggings: number;
}

type UnknownRow = Record<string, unknown>;

type NormalizedTag = {
  id: string;
  name: string;
  kind: string;
  color: string | null;
  description: string | null;
  isArchived: number;
  createdAt: string;
  updatedAt: string;
};

type NormalizedTagging = {
  id: string;
  tagId: string;
  entityType: string;
  entityId: string;
  context: string;
  createdAt: string;
};

function asRequiredString(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`Legacy ${label} is missing`);
  return normalized;
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function asArchiveFlag(value: unknown): number {
  return value === 1 || value === true || value === "1" ? 1 : 0;
}

function tableExists(database: Database.Database, table: string): boolean {
  const row = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    )
    .get(table) as { name?: string } | undefined;
  return row?.name === table;
}

function tableColumns(database: Database.Database, table: string): Set<string> {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return new Set(rows.map((row) => row.name));
}

function assertLegacySource(database: Database.Database): void {
  if (tableExists(database, "prompts") || tableExists(database, "prompt_versions")) {
    throw new Error(
      "Source appears to be the main Prompt Vault database; refusing migration",
    );
  }
  if (!tableExists(database, "tags") || !tableExists(database, "taggings")) {
    throw new Error(
      "Legacy sidecar must contain both tags and taggings tables; refusing to modify any database",
    );
  }
}

function assertSafeTarget(path: string): void {
  if (!existsSync(path)) return;
  const targetProbe = new Database(path, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    if (
      tableExists(targetProbe, "prompts") ||
      tableExists(targetProbe, "prompt_versions")
    ) {
      throw new Error(
        "Target appears to be the main Prompt Vault database; refusing migration",
      );
    }
    if (tableExists(targetProbe, "tags")) {
      const columns = tableColumns(targetProbe, "tags");
      if (!columns.has("kind")) {
        throw new Error(
          "Target contains a legacy tags schema. Choose a new app-owned target path instead of migrating in place",
        );
      }
    }
  } finally {
    targetProbe.close();
  }
}

function normalizeTag(row: UnknownRow): NormalizedTag {
  const id = asRequiredString(row.id, "tag id");
  const name = asRequiredString(row.name ?? row.label, `tag name for ${id}`);
  const kind = asOptionalString(row.kind ?? row.type) ?? "label";
  const now = new Date().toISOString();
  return {
    id,
    name,
    kind,
    color: asOptionalString(row.color),
    description: asOptionalString(row.description),
    isArchived: asArchiveFlag(row.is_archived ?? row.isArchived),
    createdAt: asOptionalString(row.created_at ?? row.createdAt) ?? now,
    updatedAt:
      asOptionalString(row.updated_at ?? row.updatedAt) ??
      asOptionalString(row.created_at ?? row.createdAt) ??
      now,
  };
}

function normalizeTagging(row: UnknownRow): NormalizedTagging {
  const id = asRequiredString(row.id, "tagging id");
  return {
    id,
    tagId: asRequiredString(row.tag_id ?? row.tagId, `tag id for ${id}`),
    entityType: asRequiredString(
      row.entity_type ?? row.entityType,
      `entity type for ${id}`,
    ),
    entityId: asRequiredString(
      row.entity_id ?? row.entityId,
      `entity id for ${id}`,
    ),
    context: asOptionalString(row.context) ?? "",
    createdAt:
      asOptionalString(row.created_at ?? row.createdAt) ??
      new Date().toISOString(),
  };
}

function ensureTargetSchema(database: Database.Database): void {
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.exec(`
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
}

export function migrateLegacyTagSidecar(
  options: LegacyTagMigrationOptions,
): LegacyTagMigrationResult {
  const sourcePath = resolve(options.sourcePath);
  const targetPath = resolve(options.targetPath);
  const dryRun = options.dryRun === true;

  if (sourcePath === targetPath) {
    throw new Error("Legacy source and target sidecar paths must be different");
  }

  const source = new Database(sourcePath, {
    readonly: true,
    fileMustExist: true,
  });

  try {
    assertLegacySource(source);

    const tags = (source.prepare("SELECT * FROM tags").all() as UnknownRow[]).map(
      normalizeTag,
    );
    const taggings = (
      source.prepare("SELECT * FROM taggings").all() as UnknownRow[]
    ).map(normalizeTagging);

    const result: LegacyTagMigrationResult = {
      sourcePath,
      targetPath,
      dryRun,
      sourceTags: tags.length,
      sourceTaggings: taggings.length,
      insertedTags: 0,
      updatedTags: 0,
      reusedTags: 0,
      insertedTaggings: 0,
      skippedTaggings: 0,
    };

    if (dryRun) return result;

    assertSafeTarget(targetPath);
    mkdirSync(dirname(targetPath), { recursive: true });
    const target = new Database(targetPath);
    try {
      ensureTargetSchema(target);

      const findTagById = target.prepare(
        "SELECT id FROM tags WHERE id = ? LIMIT 1",
      );
      const findTagByNameKind = target.prepare(
        "SELECT id FROM tags WHERE LOWER(name) = LOWER(?) AND kind = ? LIMIT 1",
      );
      const insertTag = target.prepare(
        "INSERT INTO tags (id, name, kind, color, description, is_archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      );
      const updateTag = target.prepare(
        "UPDATE tags SET name = ?, kind = ?, color = ?, description = ?, is_archived = ?, created_at = ?, updated_at = ? WHERE id = ?",
      );
      const findTagging = target.prepare(
        "SELECT id FROM taggings WHERE tag_id = ? AND entity_type = ? AND entity_id = ? AND context = ? LIMIT 1",
      );
      const insertTagging = target.prepare(
        "INSERT INTO taggings (id, tag_id, entity_type, entity_id, context, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      );

      const migrate = target.transaction(() => {
        const tagIdMap = new Map<string, string>();

        for (const tag of tags) {
          const byId = findTagById.get(tag.id) as { id: string } | undefined;
          if (byId) {
            updateTag.run(
              tag.name,
              tag.kind,
              tag.color,
              tag.description,
              tag.isArchived,
              tag.createdAt,
              tag.updatedAt,
              tag.id,
            );
            tagIdMap.set(tag.id, tag.id);
            result.updatedTags += 1;
            continue;
          }

          const byIdentity = findTagByNameKind.get(tag.name, tag.kind) as
            | { id: string }
            | undefined;
          if (byIdentity) {
            tagIdMap.set(tag.id, byIdentity.id);
            result.reusedTags += 1;
            continue;
          }

          insertTag.run(
            tag.id,
            tag.name,
            tag.kind,
            tag.color,
            tag.description,
            tag.isArchived,
            tag.createdAt,
            tag.updatedAt,
          );
          tagIdMap.set(tag.id, tag.id);
          result.insertedTags += 1;
        }

        for (const tagging of taggings) {
          const mappedTagId = tagIdMap.get(tagging.tagId);
          if (!mappedTagId) {
            result.skippedTaggings += 1;
            continue;
          }

          const existing = findTagging.get(
            mappedTagId,
            tagging.entityType,
            tagging.entityId,
            tagging.context,
          ) as { id: string } | undefined;
          if (existing) {
            result.skippedTaggings += 1;
            continue;
          }

          insertTagging.run(
            tagging.id,
            mappedTagId,
            tagging.entityType,
            tagging.entityId,
            tagging.context,
            tagging.createdAt,
          );
          result.insertedTaggings += 1;
        }
      });

      migrate();
      return result;
    } finally {
      target.close();
    }
  } finally {
    source.close();
  }
}
