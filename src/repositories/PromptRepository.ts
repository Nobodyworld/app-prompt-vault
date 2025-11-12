import type Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Prompt,
  PromptId,
  PromptSearchResult,
  PromptVersion,
  PromptFormat,
  Tag,
  AdvancedPromptSearchResult,
  PromptSearchMatch,
  SearchMatch,
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
  readonly title: string | null;
  readonly description: string | null;
  readonly category: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
  readonly version_id: string | null;
  readonly semantic_version: string | null;
  readonly body: string | null;
  readonly format: string | null;
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
 *
 * The PromptRepository encapsulates all database operations for the prompt vault,
 * providing a clean interface for CRUD operations on prompts, versions, and tags.
 * It handles SQL query construction, transaction management, and data mapping
 * between database rows and domain objects.
 *
 * Key responsibilities:
 * - Database connection and migration management
 * - CRUD operations for prompts, versions, and tags
 * - Complex search queries with filtering and pagination
 * - Transaction management for data consistency
 * - Data mapping between SQL results and domain models
 * - Telemetry and logging integration
 *
 * @example
 * ```typescript
 * const repository = new PromptRepository(database, {
 *   telemetry: myTelemetry,
 *   logger: myLogger
 * });
 *
 * const prompt = repository.getPromptById("550e8400-e29b-41d4-a716-446655440000");
 * ```
 */
export class PromptRepository {
  private readonly telemetry: Telemetry;

  private readonly logger: StructuredLogger;

  /**
   * Creates a new PromptRepository instance.
   *
   * Initializes the repository with a database connection and applies any
   * pending migrations to ensure the schema is up to date. Sets up telemetry
   * and logging for observability.
   *
   * @param database - SQLite database connection instance
   * @param options - Configuration options for telemetry and logging
   * @param options.telemetry - Optional telemetry implementation for observability
   * @param options.logger - Optional structured logger for operational insights
   *
   * @example
   * ```typescript
   * const db = new Database('prompt-vault.db');
   * const repository = new PromptRepository(db, {
   *   telemetry: createTelemetry(),
   *   logger: createLogger()
   * });
   * ```
   */
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
   * Get the underlying database instance.
   * @returns The SQLite database instance.
   */
  public getDatabase(): Database.Database {
    return this.database;
  }

  /**
   * Insert a new prompt record and its initial version.
   *
   * Creates a new prompt entity with its first version in a single transaction.
   * Handles tag association and ensures data consistency. If a prompt with the
   * same slug already exists, throws a DuplicatePromptError.
   *
   * @param prompt - Complete prompt metadata payload
   * @param version - Initial prompt version to store
   * @param tags - Optional tags to associate during creation
   * @throws DuplicatePromptError if a prompt with the same slug already exists
   *
   * @example
   * ```typescript
   * const prompt: Prompt = {
   *   id: randomUUID(),
   *   slug: "greeting-prompt",
   *   title: "Greeting Prompt",
   *   // ... other fields
   * };
   *
   * const version: PromptVersion = {
   *   id: randomUUID(),
   *   promptId: prompt.id,
   *   semanticVersion: "1.0.0",
   *   body: "Hello! How can I help you?",
   *   format: "markdown",
   *   // ... other fields
   * };
   *
   * repository.createPrompt(prompt, version, [tag1, tag2]);
   * ```
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
   *
   * Fetches a complete prompt entity with all associated tags and the most
   * recent version. Only returns active (non-deleted) prompts.
   *
   * @param promptId - Unique identifier of the prompt to fetch
   * @returns The complete prompt entity with tags and latest version
   * @throws PromptNotFoundError if no active prompt exists with the given ID
   *
   * @example
   * ```typescript
   * try {
   *   const prompt = repository.getPromptById("550e8400-e29b-41d4-a716-446655440000");
   *   console.log(`Found prompt: ${prompt.title}`);
   *   console.log(`Tags: ${prompt.tags.map(t => t.label).join(', ')}`);
   * } catch (error) {
   *   if (error instanceof PromptNotFoundError) {
   *     console.log("Prompt not found");
   *   }
   * }
   * ```
   */
  public getPromptById(promptId: PromptId): Prompt {
    return this.telemetry.withSpan("repository.getPromptById", { promptId }, () => {
      const row = this.database
        .prepare(
          `SELECT p.id, p.slug, p.title, p.description, p.category, p.created_at, p.updated_at, p.deleted_at,
                  pv.id AS version_id, pv.semantic_version, pv.body, pv.format, pv.changelog,
                  pv.created_at AS version_created_at, pv.updated_at AS version_updated_at
           FROM prompts p
           LEFT JOIN prompt_versions pv ON pv.id = (
             SELECT id FROM prompt_versions
             WHERE prompt_id = p.id
             ORDER BY datetime(created_at) DESC, rowid DESC
             LIMIT 1
           )
           WHERE p.id = @promptId AND p.deleted_at IS NULL`
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
   * Search prompts optionally filtering by text, tags, or formats.
   *
   * Performs a comprehensive search across prompt titles, descriptions, and content
   * using SQL LIKE queries. Supports filtering by tags and content formats with
   * pagination for large result sets.
   *
   * @param query - Search criteria and pagination parameters
   * @param query.text - Optional text to search for in title, description, and body
   * @param query.tags - Optional array of tag labels to filter by
   * @param query.formats - Optional array of content formats to filter by
   * @param query.page - Zero-based page number for pagination
   * @param query.pageSize - Number of results per page
   * @returns Paginated search results with total count
   *
   * @example
   * ```typescript
   * const results = repository.searchPrompts({
   *   text: "machine learning",
   *   tags: ["tutorial", "AI"],
   *   formats: ["markdown"],
   *   page: 0,
   *   pageSize: 20
   * });
   *
   * console.log(`Found ${results.total} prompts, showing page ${results.page + 1}`);
   * ```
   */
  public searchPrompts(query: {
    readonly text?: string;
    readonly tags?: readonly string[];
    readonly formats?: readonly string[];
    readonly page: number;
    readonly pageSize: number;
  }): PromptSearchResult {
    return this.telemetry.withSpan(
      "repository.searchPrompts",
      { text: query.text ?? "", tags: query.tags?.length ?? 0, formats: query.formats?.length ?? 0, page: query.page },
      () => {
        const whereClauses: string[] = [];
        const parameters: Record<string, unknown> = {};

        if (query.text) {
          whereClauses.push("(p.title LIKE @text OR p.description LIKE @text OR pv.body LIKE @text)");
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

        if (query.formats && query.formats.length > 0) {
          whereClauses.push(`pv.format IN (${query.formats.map((_, index) => `@format${index}`).join(", ")})`);
          query.formats.forEach((format, index) => {
            parameters[`format${index}`] = format;
          });
        }

        const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")} AND p.deleted_at IS NULL` : "WHERE p.deleted_at IS NULL";
        const totalRow = this.database
          .prepare(`SELECT COUNT(DISTINCT p.id) as count FROM prompts p LEFT JOIN prompt_versions pv ON pv.prompt_id = p.id ${whereClause}`)
          .get(parameters) as { count: number };

        const rows = this.database
          .prepare(
            `SELECT p.id, p.slug, p.title, p.description, p.category, p.created_at, p.updated_at, p.deleted_at,
                pv.id AS version_id, pv.semantic_version, pv.body, pv.format, pv.changelog,
                pv.created_at AS version_created_at, pv.updated_at AS version_updated_at
         FROM prompts p
         INNER JOIN prompt_versions pv ON pv.id = (
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
   * Advanced search prompts with detailed match information, excerpts, and highlighting.
   * @param query - Search filters with advanced options.
   */
  public advancedSearchPrompts(query: {
    readonly text?: string;
    readonly tags?: readonly string[];
    readonly formats?: readonly string[];
    readonly page: number;
    readonly pageSize: number;
    readonly caseSensitive: boolean;
    readonly maxResults: number;
    readonly maxMatchesPerRule: number;
    readonly maxTotalMatches: number;
  }): AdvancedPromptSearchResult {
    return this.telemetry.withSpan(
      "repository.advancedSearchPrompts",
      {
        text: query.text ?? "",
        tags: query.tags?.length ?? 0,
        formats: query.formats?.length ?? 0,
        page: query.page,
        caseSensitive: query.caseSensitive
      },
      () => {
        const whereClauses: string[] = [];
        const parameters: Record<string, unknown> = {};

        if (query.text) {
          whereClauses.push("(p.title LIKE @text OR p.description LIKE @text OR pv.body LIKE @text)");
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

        if (query.formats && query.formats.length > 0) {
          whereClauses.push(`pv.format IN (${query.formats.map((_, index) => `@format${index}`).join(", ")})`);
          query.formats.forEach((format, index) => {
            parameters[`format${index}`] = format;
          });
        }

        const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")} AND p.deleted_at IS NULL` : "WHERE p.deleted_at IS NULL";
        const totalRow = this.database
          .prepare(`SELECT COUNT(DISTINCT p.id) as count FROM prompts p LEFT JOIN prompt_versions pv ON pv.prompt_id = p.id ${whereClause}`)
          .get(parameters) as { count: number };

        const rows = this.database
          .prepare(
            `SELECT p.id, p.slug, p.title, p.description, p.category, p.created_at, p.updated_at, p.deleted_at,
                pv.id AS version_id, pv.semantic_version, pv.body, pv.format, pv.changelog,
                pv.created_at AS version_created_at, pv.updated_at AS version_created_at
         FROM prompts p
         INNER JOIN prompt_versions pv ON pv.id = (
           SELECT id FROM prompt_versions
           WHERE prompt_id = p.id
           ORDER BY datetime(created_at) DESC, rowid DESC
           LIMIT 1
         )
         ${whereClause}
         ORDER BY p.updated_at DESC
         LIMIT @limit OFFSET @offset`
          )
          .all({ ...parameters, limit: Math.min(query.pageSize, query.maxResults), offset: query.page * query.pageSize }) as PromptRow[];

        const tagsByPrompt = this.fetchTagsForPrompts(rows.map((row) => row.id));
        const matches: PromptSearchMatch[] = [];
        let totalMatches = 0;

        for (const row of rows) {
          const prompt = this.mapPromptRow(row, tagsByPrompt.get(row.id) ?? []);
          const promptMatches = this.findMatchesInPrompt(prompt, query.text, query.caseSensitive, query.maxMatchesPerRule);

          if (promptMatches.length > 0 && totalMatches + promptMatches.length <= query.maxTotalMatches) {
            matches.push({
              prompt,
              totalMatches: promptMatches.length,
              matches: promptMatches,
            });
            totalMatches += promptMatches.length;
          }

          if (matches.length >= query.maxResults || totalMatches >= query.maxTotalMatches) {
            break;
          }
        }

        return {
          matches,
          page: query.page,
          pageSize: query.pageSize,
          total: totalRow.count,
          totalMatches,
        };
      }
    );
  }

  /**
   * Find text matches within a prompt with excerpt generation.
   * @param prompt - The prompt to search in.
   * @param searchText - The text to search for.
   * @param caseSensitive - Whether the search should be case sensitive.
   * @param maxMatches - Maximum number of matches to return.
   * @returns Array of search matches with excerpts.
   */
  private findMatchesInPrompt(
    prompt: Prompt,
    searchText?: string,
    caseSensitive: boolean = false,
    maxMatches: number = 3
  ): SearchMatch[] {
    if (!searchText) {
      return [];
    }

    const matches: SearchMatch[] = [];
    const searchTerm = caseSensitive ? searchText : searchText.toLowerCase();
    const flags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);

    // Search in title
    if (prompt.title) {
      const text = caseSensitive ? prompt.title : prompt.title.toLowerCase();
      let match;
      while ((match = regex.exec(text)) !== null && matches.length < maxMatches) {
        matches.push(this.createMatchExcerpt(prompt.title, match.index, match[0].length, 100));
      }
    }

    // Search in description
    if (prompt.description) {
      const text = caseSensitive ? prompt.description : prompt.description.toLowerCase();
      let match;
      while ((match = regex.exec(text)) !== null && matches.length < maxMatches) {
        matches.push(this.createMatchExcerpt(prompt.description, match.index, match[0].length, 100));
      }
    }

    // Search in body
    if (prompt.latestVersion?.body) {
      const text = caseSensitive ? prompt.latestVersion.body : prompt.latestVersion.body.toLowerCase();
      let match;
      while ((match = regex.exec(text)) !== null && matches.length < maxMatches) {
        matches.push(this.createMatchExcerpt(prompt.latestVersion.body, match.index, match[0].length, 150));
      }
    }

    return matches;
  }

  /**
   * Create a search match excerpt with context around the match.
   * @param text - The full text to extract from.
   * @param position - Position of the match in the text.
   * @param length - Length of the matched text.
   * @param contextLength - How much context to include around the match.
   * @returns Search match with excerpt.
   */
  private createMatchExcerpt(text: string, position: number, length: number, contextLength: number): SearchMatch {
    const start = Math.max(0, position - contextLength);
    const end = Math.min(text.length, position + length + contextLength);
    const excerpt = text.substring(start, end);

    // Adjust position relative to the excerpt
    const relativePosition = position - start;

    return {
      excerpt: excerpt.length < text.length ? `...${excerpt}...` : excerpt,
      position: relativePosition,
      length,
    };
  }

  /**
   * Soft delete a prompt by setting the deleted_at timestamp.
   * @param promptId - Identifier of the prompt to delete.
   * @param deletedAt - Timestamp when the prompt was deleted.
   */
  public softDeletePrompt(promptId: PromptId, deletedAt: Date = new Date()): void {
    this.telemetry.withSpan("repository.softDeletePrompt", { promptId }, () => {
      // First check if the prompt exists and is not already deleted
      const existing = this.database
        .prepare("SELECT id FROM prompts WHERE id = @promptId AND deleted_at IS NULL")
        .get({ promptId }) as { id: string } | undefined;

      if (!existing) {
        this.logger.warn("repository_prompt_missing_or_deleted", { promptId });
        throw new PromptNotFoundError(promptId);
      }

      this.database
        .prepare("UPDATE prompts SET deleted_at = @deletedAt WHERE id = @promptId")
        .run({ promptId, deletedAt: deletedAt.toISOString() });

      this.logger.info("prompt_soft_deleted", { promptId });
    });
  }

  /**
   * Restore a soft deleted prompt by clearing the deleted_at timestamp.
   * @param promptId - Identifier of the prompt to restore.
   */
  public restorePrompt(promptId: PromptId): void {
    this.telemetry.withSpan("repository.restorePrompt", { promptId }, () => {
      // Check if the prompt exists and is deleted
      const existing = this.database
        .prepare("SELECT id FROM prompts WHERE id = @promptId AND deleted_at IS NOT NULL")
        .get({ promptId }) as { id: string } | undefined;

      if (!existing) {
        this.logger.warn("repository_prompt_missing_or_not_deleted", { promptId });
        throw new PromptNotFoundError(promptId);
      }

      this.database
        .prepare("UPDATE prompts SET deleted_at = NULL WHERE id = @promptId")
        .run({ promptId });

      this.logger.info("prompt_restored", { promptId });
    });
  }

  /**
   * Get all soft deleted prompts.
   * @returns Array of deleted prompts with their metadata.
   */
  public getDeletedPrompts(): readonly Prompt[] {
    return this.telemetry.withSpan("repository.getDeletedPrompts", {}, () => {
      const rows = this.database
        .prepare(
          `SELECT p.id, p.slug, p.title, p.description, p.category, p.created_at, p.updated_at, p.deleted_at,
                  pv.id AS version_id, pv.semantic_version, pv.body, pv.format, pv.changelog,
                  pv.created_at AS version_created_at, pv.updated_at AS version_updated_at
           FROM prompts p
           LEFT JOIN prompt_versions pv ON pv.id = (
             SELECT id FROM prompt_versions
             WHERE prompt_id = p.id
             ORDER BY datetime(created_at) DESC, rowid DESC
             LIMIT 1
           )
           WHERE p.deleted_at IS NOT NULL
           ORDER BY p.deleted_at DESC`
        )
        .all() as PromptRow[];

      const tagsByPrompt = this.fetchTagsForPrompts(rows.map((row) => row.id));
      return rows.map((row) => this.mapPromptRow(row, tagsByPrompt.get(row.id) ?? []));
    });
  }

  /**
   * Permanently delete a prompt and all its associated data.
   * @param promptId - Identifier of the prompt to permanently delete.
   */
  public permanentlyDeletePrompt(promptId: PromptId): void {
    this.telemetry.withSpan("repository.permanentlyDeletePrompt", { promptId }, () => {
      this.runTransaction(() => {
        // Delete prompt_tags first (cascade will handle this, but being explicit)
        this.database.prepare("DELETE FROM prompt_tags WHERE prompt_id = @promptId").run({ promptId });

        // Delete versions
        this.database.prepare("DELETE FROM prompt_versions WHERE prompt_id = @promptId").run({ promptId });

        // Delete the prompt itself
        const result = this.database.prepare("DELETE FROM prompts WHERE id = @promptId").run({ promptId });

        if (result.changes === 0) {
          this.logger.warn("repository_prompt_missing_for_deletion", { promptId });
          throw new PromptNotFoundError(promptId);
        }

        this.logger.info("prompt_permanently_deleted", { promptId });
      });
    });
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
    // TODO: Fix this path resolution to be more robust
    const migrationsDir = "C:\\Users\\Nobod\\Documents\\GitHub\\app-prompt-vault\\src\\db\\migrations";
    const migrationFiles = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort(); // Apply deterministically (001_*, 002_*, ...).

    for (const file of migrationFiles) {
      try {
        const sql = readFileSync(join(migrationsDir, file), "utf8");
        this.database.exec(sql);
        this.logger.debug("migration_applied", { file });
      } catch (error) {
        // Check if this is a "duplicate column name" error, which means the migration was already applied
        if (error instanceof Error && error.message.includes("duplicate column name")) {
          this.logger.debug("migration_already_applied", { file });
          continue;
        }
        // Re-throw other errors
        throw error;
      }
    }
  }

  private insertPromptRecord(prompt: Prompt): void {
    const statement = this.database.prepare(
      `INSERT INTO prompts (id, slug, title, description, category, created_at, updated_at)
       VALUES (@id, @slug, @title, @description, @category, @createdAt, @updatedAt)`
    );

    statement.run({
      id: prompt.id,
      slug: prompt.slug,
      title: prompt.title,
      description: prompt.description ?? null,
      category: prompt.category ?? null,
      createdAt: prompt.createdAt.toISOString(),
      updatedAt: prompt.updatedAt.toISOString(),
    });
  }

  private insertVersionRecord(version: PromptVersion): void {
    const statement = this.database.prepare(
      `INSERT INTO prompt_versions (id, prompt_id, semantic_version, body, format, changelog, created_at, updated_at)
       VALUES (@id, @promptId, @semanticVersion, @body, @format, @changelog, @createdAt, @updatedAt)`
    );

    statement.run({
      id: version.id,
      promptId: version.promptId,
      semanticVersion: version.semanticVersion,
      body: version.body,
      format: version.format,
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
      title: row.title ?? "",
      description: row.description ?? undefined,
      category: row.category ?? undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      deletedAt: row.deleted_at ? new Date(row.deleted_at) : undefined,
      tags,
      latestVersion: row.version_id
        ? {
          id: row.version_id,
          promptId: row.id,
          semanticVersion: row.semantic_version ?? "",
          body: row.body ?? "",
          format: (row.format as PromptFormat) ?? "markdown",
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

  /**
   * Get all prompts (including deleted ones for diagnostics).
   * @returns Array of all prompts with their metadata.
   */
  public getAllPrompts(): readonly Prompt[] {
    return this.telemetry.withSpan("repository.getAllPrompts", {}, () => {
      const rows = this.database
        .prepare(
          `SELECT p.id, p.slug, p.title, p.description, p.category, p.created_at, p.updated_at, p.deleted_at,
                  pv.id AS version_id, pv.semantic_version, pv.body, pv.format, pv.changelog,
                  pv.created_at AS version_created_at, pv.updated_at AS version_updated_at
           FROM prompts p
           LEFT JOIN prompt_versions pv ON pv.id = (
             SELECT id FROM prompt_versions
             WHERE prompt_id = p.id
             ORDER BY datetime(created_at) DESC, rowid DESC
             LIMIT 1
           )
           ORDER BY p.created_at DESC`
        )
        .all() as PromptRow[];

      const tagsByPrompt = this.fetchTagsForPrompts(rows.map((row) => row.id));
      return rows.map((row) => this.mapPromptRow(row, tagsByPrompt.get(row.id) ?? []));
    });
  }

  /**
   * Get all tags in the system.
   * @returns Array of all tags.
   */
  public getAllTags(): readonly Tag[] {
    return this.telemetry.withSpan("repository.getAllTags", {}, () => {
      const rows = this.database
        .prepare(
          `SELECT id, label, description, created_at
           FROM tags
           ORDER BY LOWER(label), label`
        )
        .all() as { id: string; label: string; description: string | null; created_at: string }[];

      return rows.map((row) => ({
        id: row.id,
        label: row.label,
        description: row.description ?? undefined,
        createdAt: new Date(row.created_at),
      }));
    });
  }

  /**
   * Update the format of a specific version.
   * @param versionId - ID of the version to update.
   * @param format - New format for the version.
   */
  public updateVersionFormat(versionId: string, format: PromptFormat): void {
    this.telemetry.withSpan("repository.updateVersionFormat", { versionId, format }, () => {
      const result = this.database
        .prepare("UPDATE prompt_versions SET format = @format WHERE id = @versionId")
        .run({ versionId, format });

      if (result.changes === 0) {
        throw new Error(`Version not found: ${versionId}`);
      }

      this.logger.info("version_format_updated", { versionId, format });
    });
  }

  private runTransaction<T>(operation: () => T): T {
    return this.database.transaction(operation)();
  }
}
