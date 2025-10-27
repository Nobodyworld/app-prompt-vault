import type Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Prompt,
  PromptId,
  PromptSearchResult,
  PromptVersion,
  Tag,
} from "../domain/models.js";
import { DuplicatePromptError, PromptNotFoundError } from "../domain/errors.js";
import type { Telemetry } from "../observability/telemetry.js";
import { createNoopTelemetry } from "../observability/telemetry.js";
import type { StructuredLogger } from "../observability/logger.js";
import { createLoggerFromEnv } from "../observability/logger.js";

interface PromptRepositoryOptions {
  readonly telemetry?: Telemetry;
  readonly logger?: StructuredLogger;
}

interface PromptRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly version_id: string | null;
  readonly semantic_version: string | null;
  readonly body: string | null;
  readonly changelog: string | null;
  readonly version_created_at: string | null;
  readonly version_updated_at: string | null;
}

interface TagRow {
  readonly promptId: string;
  readonly id: string;
  readonly label: string;
  readonly description: string | null;
  readonly created_at: string;
}

/**
 * Provides data access helpers for prompts, tags, and versions.
 */
export class PromptRepository {
  private readonly telemetry: Telemetry;

  private readonly logger: StructuredLogger;

  public constructor(
    private readonly database: Database.Database,
    options: PromptRepositoryOptions = {}
  ) {
    this.telemetry = options.telemetry ?? createNoopTelemetry();
    this.logger = options.logger ?? createLoggerFromEnv({ serviceName: "prompt-repository" });
    this.telemetry.withSpan("repository.applyMigrations", {}, () => {
      this.applyMigrations();
    });
  }

  /**
   * Insert a new prompt record and its initial version.
   * @param prompt - Prompt metadata payload.
   * @param version - Initial prompt version to store.
   * @param tags - Optional tags to associate during creation.
   */
  public createPrompt(prompt: Prompt, version: PromptVersion, tags: readonly Tag[] = []): void {
    this.telemetry.withSpan("repository.createPrompt", { promptId: prompt.id }, () => {
      try {
        this.runTransaction(() => {
          this.insertPromptRecord(prompt);
          this.insertVersionRecord(version);

          if (tags.length > 0) {
            this.persistTags(prompt.id, tags);
          }
        });
      } catch (error: unknown) {
        if (error instanceof Error && "code" in error && (error as { code: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
          this.logger.warn("repository_duplicate_prompt", { promptId: prompt.id, slug: prompt.slug });
          throw new DuplicatePromptError(prompt.slug);
        }
        throw error;
      }
    });
  }

  /**
   * Retrieve a prompt by identifier including tags and latest version.
   * @param promptId - Identifier of the prompt to fetch.
   * @returns The prompt if found.
   */
  public getPromptById(promptId: PromptId): Prompt {
    return this.telemetry.withSpan("repository.getPromptById", { promptId }, () => {
      const row = this.database
        .prepare(
          `SELECT p.id, p.slug, p.title, p.description, p.created_at, p.updated_at,
                  pv.id AS version_id, pv.semantic_version, pv.body, pv.changelog,
                  pv.created_at AS version_created_at, pv.updated_at AS version_updated_at
           FROM prompts p
           LEFT JOIN prompt_versions pv ON pv.id = (
             SELECT id FROM prompt_versions
             WHERE prompt_id = p.id
             ORDER BY datetime(created_at) DESC, rowid DESC
             LIMIT 1
           )
           WHERE p.id = @promptId`
        )
        .get({ promptId }) as PromptRow | undefined;

      if (!row) {
        this.logger.warn("repository_prompt_missing", { promptId });
        throw new PromptNotFoundError(promptId);
      }

      const tags = this.fetchTagsForPrompts([promptId]).get(promptId) ?? [];

      return this.mapPromptRow(row, tags);
    });
  }

  /**
   * Search prompts optionally filtering by text or tags.
   * @param query - Search filters.
   */
  public searchPrompts(query: {
    readonly text?: string;
    readonly tags?: readonly string[];
    readonly page: number;
    readonly pageSize: number;
  }): PromptSearchResult {
    return this.telemetry.withSpan(
      "repository.searchPrompts",
      { text: query.text ?? "", tags: query.tags?.length ?? 0, page: query.page },
      () => {
        const whereClauses: string[] = [];
        const parameters: Record<string, unknown> = {};

        if (query.text) {
          whereClauses.push("(p.title LIKE @text OR p.description LIKE @text)");
          parameters.text = `%${query.text}%`;
        }

        if (query.tags && query.tags.length > 0) {
          whereClauses.push(`p.id IN (
        SELECT pt.prompt_id FROM prompt_tags pt
        INNER JOIN tags t ON t.id = pt.tag_id
        WHERE t.label IN (${query.tags.map((_, index) => `@tag${index}`).join(", ")})
      )`);
          query.tags.forEach((tag, index) => {
            parameters[`tag${index}`] = tag;
          });
        }

        const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
        const totalRow = this.database
          .prepare(`SELECT COUNT(*) as count FROM prompts p ${whereClause}`)
          .get(parameters) as { count: number };

        const rows = this.database
          .prepare(
            `SELECT p.id, p.slug, p.title, p.description, p.created_at, p.updated_at,
                pv.id AS version_id, pv.semantic_version, pv.body, pv.changelog,
                pv.created_at AS version_created_at, pv.updated_at AS version_updated_at
         FROM prompts p
         LEFT JOIN prompt_versions pv ON pv.id = (
           SELECT id FROM prompt_versions
           WHERE prompt_id = p.id
           ORDER BY datetime(created_at) DESC, rowid DESC
           LIMIT 1
         )
         ${whereClause}
         ORDER BY p.updated_at DESC
         LIMIT @limit OFFSET @offset`
          )
          .all({ ...parameters, limit: query.pageSize, offset: query.page * query.pageSize }) as PromptRow[];

        const tagsByPrompt = this.fetchTagsForPrompts(rows.map((row) => row.id));
        const prompts = rows.map((row) => this.mapPromptRow(row, tagsByPrompt.get(row.id) ?? []));

        return {
          prompts,
          page: query.page,
          pageSize: query.pageSize,
          total: totalRow.count,
        };
      }
    );
  }

  /**
   * Assign tags to a prompt, creating new tags if needed.
   * @param promptId - Identifier of the prompt.
   * @param tags - Tag labels to associate.
   */
  public upsertTags(promptId: PromptId, tags: readonly Tag[], updatedAt: Date = new Date()): void {
    if (tags.length === 0) {
      return;
    }

    this.telemetry.withSpan("repository.upsertTags", { promptId, count: tags.length }, () => {
      this.runTransaction(() => {
        this.persistTags(promptId, tags);
        this.updatePromptTimestamps(promptId, updatedAt.toISOString());
      });
    });
  }

  /**
   * Remove tag associations from a prompt. Tags that are no longer referenced will be garbage collected.
   * @param promptId - Identifier of the prompt to update.
   * @param labels - Tag labels to remove (case-insensitive).
   * @param updatedAt - Timestamp applied to the prompt update metadata.
   */
  public removeTags(promptId: PromptId, labels: readonly string[], updatedAt: Date = new Date()): void {
    if (labels.length === 0) {
      return;
    }

    this.telemetry.withSpan("repository.removeTags", { promptId, count: labels.length }, () => {
      this.runTransaction(() => {
        const normalized = labels.map((label) => label.toLowerCase());

        const tagIds = this.database
          .prepare(
            `SELECT id FROM tags WHERE LOWER(label) IN (${normalized
              .map((_, index) => `@label${index}`)
              .join(", ")})`
          )
          .all(
            normalized.reduce<Record<string, string>>((parameters, label, index) => {
              parameters[`label${index}`] = label;
              return parameters;
            }, {})
          ) as { id: string }[];

        if (tagIds.length === 0) {
          return;
        }

        const placeholders = tagIds.map((_, index) => `@tag${index}`);
        const parameters = tagIds.reduce<Record<string, string>>((accumulator, tag, index) => {
          accumulator[`tag${index}`] = tag.id;
          return accumulator;
        }, { promptId });

        this.database
          .prepare(
            `DELETE FROM prompt_tags WHERE prompt_id = @promptId AND tag_id IN (${placeholders.join(", ")})`
          )
          .run(parameters);

        this.database
          .prepare(
            `DELETE FROM tags
             WHERE id IN (${placeholders.join(", ")})
             AND NOT EXISTS (SELECT 1 FROM prompt_tags WHERE tag_id = tags.id)`
          )
          .run(parameters);

        this.updatePromptTimestamps(promptId, updatedAt.toISOString());
      });
    });
  }

  /**
   * Record a new version for a prompt.
   * @param version - Version metadata to persist.
   */
  public addVersion(version: PromptVersion): void {
    this.telemetry.withSpan("repository.addVersion", { promptId: version.promptId }, () => {
      this.runTransaction(() => {
        this.insertVersionRecord(version);
        this.updatePromptTimestamps(version.promptId, version.updatedAt.toISOString());
      });
    });
  }

  private applyMigrations(): void {
    const migrationsDir = fileURLToPath(new URL("../db/migrations/", import.meta.url));
    const migrationFiles = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort(); // Apply deterministically (001_*, 002_*, ...).

    for (const file of migrationFiles) {
      const sql = readFileSync(join(migrationsDir, file), "utf8");
      this.database.exec(sql);
    }
  }

  private insertPromptRecord(prompt: Prompt): void {
    const statement = this.database.prepare(
      `INSERT INTO prompts (id, slug, title, description, created_at, updated_at)
       VALUES (@id, @slug, @title, @description, @createdAt, @updatedAt)`
    );

    statement.run({
      id: prompt.id,
      slug: prompt.slug,
      title: prompt.title,
      description: prompt.description ?? null,
      createdAt: prompt.createdAt.toISOString(),
      updatedAt: prompt.updatedAt.toISOString(),
    });
  }

  private insertVersionRecord(version: PromptVersion): void {
    const statement = this.database.prepare(
      `INSERT INTO prompt_versions (id, prompt_id, semantic_version, body, changelog, created_at, updated_at)
       VALUES (@id, @promptId, @semanticVersion, @body, @changelog, @createdAt, @updatedAt)`
    );

    statement.run({
      id: version.id,
      promptId: version.promptId,
      semanticVersion: version.semanticVersion,
      body: version.body,
      changelog: version.changelog ?? null,
      createdAt: version.createdAt.toISOString(),
      updatedAt: version.updatedAt.toISOString(),
    });
  }

  private persistTags(promptId: PromptId, tags: readonly Tag[]): void {
    if (tags.length === 0) {
      return;
    }

    const uniqueTags = new Map<string, Tag>();
    for (const tag of tags) {
      const key = tag.label.toLowerCase();
      const existing = uniqueTags.get(key);
      if (!existing || (!existing.description && tag.description)) {
        uniqueTags.set(key, tag);
      }
    }

    const insertTag = this.database.prepare(
      `INSERT INTO tags (id, label, description, created_at)
       VALUES (@id, @label, @description, @createdAt)
       ON CONFLICT(label) DO UPDATE SET
         description = COALESCE(excluded.description, tags.description)
       RETURNING id`
    );

    const insertLink = this.database.prepare(
      `INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id)
       VALUES (@promptId, @tagId)`
    );

    for (const tag of uniqueTags.values()) {
      const persisted = insertTag.get({
        id: tag.id,
        label: tag.label,
        description: tag.description ?? null,
        createdAt: tag.createdAt.toISOString(),
      }) as { id: string };
      insertLink.run({ promptId, tagId: persisted.id });
    }
  }

  private fetchTagsForPrompts(promptIds: readonly string[]): Map<string, Tag[]> {
    if (promptIds.length === 0) {
      return new Map();
    }

    const placeholders = promptIds.map((_, index) => `@prompt${index}`);
    const parameters = promptIds.reduce<Record<string, string>>((accumulator, promptId, index) => {
      accumulator[`prompt${index}`] = promptId;
      return accumulator;
    }, {});

    const rows = this.database
      .prepare(
        `SELECT pt.prompt_id as promptId, t.id, t.label, t.description, t.created_at
         FROM prompt_tags pt
         INNER JOIN tags t ON t.id = pt.tag_id
         WHERE pt.prompt_id IN (${placeholders.join(", ")})
         ORDER BY LOWER(t.label), t.label`
      )
      .all(parameters) as TagRow[];

    return rows.reduce<Map<string, Tag[]>>((map, row) => {
      const tags = map.get(row.promptId) ?? [];
      tags.push({
        id: row.id,
        label: row.label,
        description: row.description ?? undefined,
        createdAt: new Date(row.created_at),
      });
      map.set(row.promptId, tags);
      return map;
    }, new Map());
  }

  private mapPromptRow(row: PromptRow, tags: readonly Tag[]): Prompt {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description ?? undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      tags,
      latestVersion: row.version_id
        ? {
            id: row.version_id,
            promptId: row.id,
            semanticVersion: row.semantic_version ?? "",
            body: row.body ?? "",
            changelog: row.changelog ?? undefined,
            createdAt: new Date(row.version_created_at ?? row.updated_at),
            updatedAt: new Date(row.version_updated_at ?? row.updated_at),
          }
        : undefined,
    };
  }

  private updatePromptTimestamps(promptId: PromptId, isoDate: string): void {
    this.database
      .prepare(`UPDATE prompts SET updated_at = @updatedAt WHERE id = @promptId`)
      .run({ promptId, updatedAt: isoDate });
  }

  private runTransaction<T>(operation: () => T): T {
    return this.database.transaction(operation)();
  }
}
