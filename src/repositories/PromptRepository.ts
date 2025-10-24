import type Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  Prompt,
  PromptId,
  PromptSearchResult,
  PromptVersion,
  Tag,
} from "../domain/models.js";
import { DuplicatePromptError, PromptNotFoundError } from "../domain/errors.js";

/**
 * Provides data access helpers for prompts, tags, and versions.
 */
export class PromptRepository {
  public constructor(private readonly database: Database.Database) {
    this.applyMigrations();
  }

  /**
   * Insert a new prompt record and its initial version.
   * @param prompt - Prompt metadata payload.
   * @param version - Initial prompt version to store.
   */
  public createPrompt(prompt: Prompt, version: PromptVersion): void {
    const nowIso = new Date().toISOString();
    try {
      const insertPrompt = this.database.prepare(
        `INSERT INTO prompts (id, slug, title, description, created_at, updated_at)
         VALUES (@id, @slug, @title, @description, @createdAt, @updatedAt)`
      );
      insertPrompt.run({
        id: prompt.id,
        slug: prompt.slug,
        title: prompt.title,
        description: prompt.description ?? null,
        createdAt: prompt.createdAt.toISOString(),
        updatedAt: prompt.updatedAt.toISOString(),
      });
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && (error as { code: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new DuplicatePromptError(prompt.slug);
      }
      throw error;
    }

    const insertVersion = this.database.prepare(
      `INSERT INTO prompt_versions (id, prompt_id, semantic_version, body, changelog, created_at, updated_at)
       VALUES (@id, @promptId, @semanticVersion, @body, @changelog, @createdAt, @updatedAt)`
    );
    insertVersion.run({
      id: version.id,
      promptId: version.promptId,
      semanticVersion: version.semanticVersion,
      body: version.body,
      changelog: version.changelog ?? null,
      createdAt: version.createdAt.toISOString(),
      updatedAt: version.updatedAt.toISOString(),
    });

    this.updatePromptTimestamps(prompt.id, nowIso);
  }

  /**
   * Retrieve a prompt by identifier including tags and latest version.
   * @param promptId - Identifier of the prompt to fetch.
   * @returns The prompt if found.
   */
  public getPromptById(promptId: PromptId): Prompt {
    const row = this.database
      .prepare(
        `SELECT p.id, p.slug, p.title, p.description, p.created_at, p.updated_at,
                pv.id AS version_id, pv.semantic_version, pv.body, pv.changelog,
                pv.created_at AS version_created_at, pv.updated_at AS version_updated_at
         FROM prompts p
         LEFT JOIN prompt_versions pv ON pv.prompt_id = p.id
         WHERE p.id = @promptId
         ORDER BY pv.created_at DESC
         LIMIT 1`
      )
      .get({ promptId }) as Record<string, unknown> | undefined;

    if (!row) {
      throw new PromptNotFoundError(promptId);
    }

    const tags = this.getTagsForPrompt(promptId);

    const prompt: Prompt = {
      id: row.id as string,
      slug: row.slug as string,
      title: row.title as string,
      description: (row.description as string | null) ?? undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
      tags,
      latestVersion: row.version_id
        ? {
            id: row.version_id as string,
            promptId,
            semanticVersion: row.semantic_version as string,
            body: row.body as string,
            changelog: (row.changelog as string | null) ?? undefined,
            createdAt: new Date(row.version_created_at as string),
            updatedAt: new Date(row.version_updated_at as string),
          }
        : undefined,
    };

    return prompt;
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
        `SELECT p.id FROM prompts p
         ${whereClause}
         ORDER BY p.updated_at DESC
         LIMIT @limit OFFSET @offset`
      )
      .all({ ...parameters, limit: query.pageSize, offset: query.page * query.pageSize }) as { id: string }[];

    const prompts = rows.map((row) => this.getPromptById(row.id));

    return {
      prompts,
      page: query.page,
      pageSize: query.pageSize,
      total: totalRow.count,
    };
  }

  /**
   * Assign tags to a prompt, creating new tags if needed.
   * @param promptId - Identifier of the prompt.
   * @param tags - Tag labels to associate.
   */
  public upsertTags(promptId: PromptId, tags: readonly Tag[]): void {
    const insertTag = this.database.prepare(
      `INSERT INTO tags (id, label, description, created_at)
       VALUES (@id, @label, @description, @createdAt)
       ON CONFLICT(label) DO UPDATE SET description=excluded.description`
    );

    const insertLink = this.database.prepare(
      `INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id)
       VALUES (@promptId, @tagId)`
    );

    tags.forEach((tag) => {
      insertTag.run({
        id: tag.id,
        label: tag.label,
        description: tag.description ?? null,
        createdAt: tag.createdAt.toISOString(),
      });
      insertLink.run({ promptId, tagId: tag.id });
    });
  }

  /**
   * Record a new version for a prompt.
   * @param version - Version metadata to persist.
   */
  public addVersion(version: PromptVersion): void {
    const insertVersion = this.database.prepare(
      `INSERT INTO prompt_versions (id, prompt_id, semantic_version, body, changelog, created_at, updated_at)
       VALUES (@id, @promptId, @semanticVersion, @body, @changelog, @createdAt, @updatedAt)`
    );
    insertVersion.run({
      id: version.id,
      promptId: version.promptId,
      semanticVersion: version.semanticVersion,
      body: version.body,
      changelog: version.changelog ?? null,
      createdAt: version.createdAt.toISOString(),
      updatedAt: version.updatedAt.toISOString(),
    });

    this.updatePromptTimestamps(version.promptId, version.updatedAt.toISOString());
  }

  private updatePromptTimestamps(promptId: PromptId, isoDate: string): void {
    this.database
      .prepare(`UPDATE prompts SET updated_at = @updatedAt WHERE id = @promptId`)
      .run({ promptId, updatedAt: isoDate });
  }

  private getTagsForPrompt(promptId: PromptId): Tag[] {
    const rows = this.database
      .prepare(
        `SELECT t.id, t.label, t.description, t.created_at
         FROM tags t
         INNER JOIN prompt_tags pt ON pt.tag_id = t.id
         WHERE pt.prompt_id = @promptId`
      )
      .all({ promptId }) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: row.id as string,
      label: row.label as string,
      description: (row.description as string | null) ?? undefined,
      createdAt: new Date(row.created_at as string),
    }));
  }

  private applyMigrations(): void {
    const migrationUrl = new URL("../db/migrations/001_init.sql", import.meta.url);
    const sql = readFileSync(fileURLToPath(migrationUrl), "utf8");
    this.database.exec(sql);
  }
}
