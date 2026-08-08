import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateIntegrityChecksum,
  checkDataIntegrity,
} from "../lib/platform-core.js";
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
  readonly is_favorite: number;
  readonly rating: number | null;
  readonly integrity_checksum: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
  readonly version_id: string | null;
  readonly semantic_version: string | null;
  readonly body: string | null;
  readonly format: string | null;
  readonly changelog: string | null;
  readonly version_integrity_checksum: string | null;
  readonly version_created_at: string | null;
  readonly version_updated_at: string | null;
}

export class PromptRepository {
  private readonly database: BetterSqlite3Database;
  private readonly telemetry: Telemetry;
  private readonly logger: StructuredLogger;
  private promptsFtsAvailable: boolean | null = null;

  public constructor(
    database: BetterSqlite3Database,
    options: PromptRepositoryOptions = {},
  ) {
    this.database = database;
    this.telemetry = options.telemetry ?? createNoopTelemetry();
    this.logger =
      options.logger ??
      createLoggerFromEnv({ serviceName: "prompt-vault-repository" });
    this.applyMigrations();
  }

  private hasPromptsFts(): boolean {
    if (this.promptsFtsAvailable !== null) {
      return this.promptsFtsAvailable;
    }

    try {
      const row = this.database
        .prepare(
          "SELECT 1 as ok FROM sqlite_master WHERE type='table' AND name='prompts_fts' LIMIT 1",
        )
        .get() as { ok?: number } | undefined;
      this.promptsFtsAvailable = Boolean(row?.ok);
    } catch {
      this.promptsFtsAvailable = false;
    }

    return this.promptsFtsAvailable;
  }

  private buildFtsQuery(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) {
      return "";
    }

    const tokens = trimmed.split(/\s+/g).filter((token) => token.length > 0);
    if (tokens.length === 0) {
      return "";
    }

    const normalized = tokens.map((token) => {
      const safe = token.replace(/"/g, '""');
      // Prefer prefix matching for simple text searches.
      return /^[a-zA-Z0-9_-]+$/.test(safe) ? `${safe}*` : `"${safe}"*`;
    });

    return normalized.join(" AND ");
  }

  public getPromptIdBySlug(slug: string): PromptId | null {
    return this.telemetry.withSpan(
      "repository.getPromptIdBySlug",
      { slug },
      () => {
        const row = this.database
          .prepare(
            "SELECT id FROM prompts WHERE slug = @slug AND deleted_at IS NULL",
          )
          .get({ slug }) as { id: string } | undefined;
        return row?.id ?? null;
      },
    );
  }

  /**
   * Create a prompt with its initial version.
   *
   * @param prompt - Complete prompt metadata payload
   * @param version - Initial prompt version to store
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
   * repository.createPrompt(prompt, version);
   * ```
   */
  public createPrompt(prompt: Prompt, version: PromptVersion): void {
    this.telemetry.withSpan(
      "repository.createPrompt",
      { promptId: prompt.id },
      () => {
        try {
          this.runTransaction(() => {
            this.insertPromptRecord(prompt);
            this.insertVersionRecord(version);
          });
        } catch (error: unknown) {
          if (
            error instanceof Error &&
            "code" in error &&
            (error as { code: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
          ) {
            this.logger.warn("repository_duplicate_prompt", {
              promptId: prompt.id,
              slug: prompt.slug,
            });
            throw new DuplicatePromptError(prompt.slug);
          }
          throw error;
        }
      },
    );
  }

  /**
   * Retrieve a prompt by identifier including latest version.
   *
   * Fetches a complete prompt entity with the most recent version. Only returns
   * active (non-deleted) prompts. Tags are now attached by the service layer.
   *
   * @param promptId - Unique identifier of the prompt to fetch
   * @returns The complete prompt entity with latest version
   * @throws PromptNotFoundError if no active prompt exists with the given ID
   *
   * @example
   * ```typescript
   * try {
   *   const prompt = repository.getPromptById("550e8400-e29b-41d4-a716-446655440000");
   *   console.log(`Found prompt: ${prompt.title}`);
   * } catch (error) {
   *   if (error instanceof PromptNotFoundError) {
   *     console.log("Prompt not found");
   *   }
   * }
   * ```
   */
  public getPromptById(promptId: PromptId): Prompt {
    return this.telemetry.withSpan(
      "repository.getPromptById",
      { promptId },
      () => {
        const row = this.database
          .prepare(
            `SELECT p.id, p.slug, p.title, p.description, p.category, p.is_favorite, p.rating, p.integrity_checksum, p.created_at, p.updated_at, p.deleted_at,
                  pv.id AS version_id, pv.semantic_version, pv.body, pv.format, pv.changelog, pv.integrity_checksum AS version_integrity_checksum,
                  pv.created_at AS version_created_at, pv.updated_at AS version_updated_at
           FROM prompts p
           LEFT JOIN prompt_versions pv ON pv.id = (
             SELECT id FROM prompt_versions
             WHERE prompt_id = p.id
             ORDER BY datetime(created_at) DESC, rowid DESC
             LIMIT 1
           )
           WHERE p.id = @promptId AND p.deleted_at IS NULL`,
          )
          .get({ promptId }) as PromptRow | undefined;

        if (!row) {
          this.logger.warn("repository_prompt_missing", { promptId });
          throw new PromptNotFoundError(promptId);
        }

        // Verify prompt integrity
        if (row.integrity_checksum) {
          const promptData = this.buildPromptChecksumPayload({
            id: row.id,
            slug: row.slug,
            title: row.title ?? null,
            description: row.description ?? null,
            category: row.category ?? null,
            isFavorite: row.is_favorite === 1,
            rating: row.rating ?? null,
          });
          const integrityCheck = checkDataIntegrity(
            promptData,
            row.integrity_checksum,
          );
          if (!integrityCheck.isValid) {
            this.logger.error("Prompt integrity check failed", {
              promptId,
              expected: integrityCheck.expectedChecksum,
              actual: integrityCheck.actualChecksum,
            });
            throw new Error(
              `Data integrity check failed for prompt '${promptId}'`,
            );
          }
        }

        // Verify version integrity if present
        if (row.version_integrity_checksum && row.body) {
          const integrityCheck = checkDataIntegrity(
            row.body,
            row.version_integrity_checksum,
          );
          if (!integrityCheck.isValid) {
            this.logger.error("Prompt version integrity check failed", {
              promptId,
              versionId: row.version_id,
              expected: integrityCheck.expectedChecksum,
              actual: integrityCheck.actualChecksum,
            });
            throw new Error(
              `Data integrity check failed for prompt version '${row.version_id}'`,
            );
          }
        }

        const tags = this.getTagsForPrompt(promptId);
        return this.mapPromptRow(row, tags);
      },
    );
  }

  /**
   * Search prompts optionally filtering by text or formats.
   *
   * Performs a comprehensive search across prompt titles, descriptions, and content
   * using SQL LIKE queries. Tag filtering is now handled at the service layer.
   * Supports filtering by content formats with pagination for large result sets.
   *
   * @param query - Search criteria and pagination parameters
   * @param query.text - Optional text to search for in title, description, and body
   * @param query.formats - Optional array of content formats to filter by
   * @param query.page - Zero-based page number for pagination
   * @param query.pageSize - Number of results per page
   * @returns Paginated search results with total count
   *
   * @example
   * ```typescript
   * const results = repository.searchPrompts({
   *   text: "machine learning",
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
    readonly formats?: readonly string[];
    readonly page: number;
    readonly pageSize: number;
    readonly category?: string;
  }): PromptSearchResult {
    return this.telemetry.withSpan(
      "repository.searchPrompts",
      {
        text: query.text ?? "",
        formats: query.formats?.length ?? 0,
        page: query.page,
      },
      () => {
        const whereClauses: string[] = [];
        const parameters: Record<string, unknown> = {};

        const normalizedCategory = query.category?.trim();
        if (normalizedCategory) {
          whereClauses.push("p.category = @category");
          parameters.category = normalizedCategory;
        }

        const wantsFts = Boolean(query.text?.trim());
        const canUseFts = wantsFts && this.hasPromptsFts();

        if (query.text && canUseFts) {
          const ftsQuery = this.buildFtsQuery(query.text);
          if (ftsQuery) {
            whereClauses.push("prompts_fts MATCH @ftsQuery");
            parameters.ftsQuery = ftsQuery;
          }
        } else if (query.text) {
          whereClauses.push(
            "(p.title LIKE @text OR p.description LIKE @text OR pv.body LIKE @text)",
          );
          parameters.text = `%${query.text}%`;
        }

        if (query.formats && query.formats.length > 0) {
          whereClauses.push(
            `pv.format IN (${query.formats.map((_, index) => `@format${index}`).join(", ")})`,
          );
          query.formats.forEach((format, index) => {
            parameters[`format${index}`] = format;
          });
        }

        const whereClause =
          whereClauses.length > 0
            ? `WHERE ${whereClauses.join(" AND ")} AND p.deleted_at IS NULL`
            : "WHERE p.deleted_at IS NULL";

        const fromClause = canUseFts
          ? "FROM prompts p INNER JOIN prompts_fts ON prompts_fts.rowid = p.rowid"
          : "FROM prompts p";

        const totalRow = this.database
          .prepare(
            `SELECT COUNT(DISTINCT p.id) as count
             ${fromClause}
             LEFT JOIN prompt_versions pv ON pv.prompt_id = p.id
             ${whereClause}`,
          )
          .get(parameters) as { count: number };

        const orderByClause = canUseFts
          ? "ORDER BY bm25(prompts_fts) ASC, p.updated_at DESC"
          : "ORDER BY p.updated_at DESC";

        const rows = this.database
          .prepare(
            `SELECT p.id, p.slug, p.title, p.description, p.category, p.is_favorite, p.rating, p.created_at, p.updated_at, p.deleted_at,
                pv.id AS version_id, pv.semantic_version, pv.body, pv.format, pv.changelog,
                pv.created_at AS version_created_at, pv.updated_at AS version_updated_at
             ${fromClause}
             INNER JOIN prompt_versions pv ON pv.id = (
               SELECT id FROM prompt_versions
               WHERE prompt_id = p.id
               ORDER BY datetime(created_at) DESC, rowid DESC
               LIMIT 1
             )
             ${whereClause}
             ${orderByClause}
             LIMIT @limit OFFSET @offset`,
          )
          .all({
            ...parameters,
            limit: query.pageSize,
            offset: query.page * query.pageSize,
          }) as PromptRow[];

        const prompts = rows.map((row) => this.mapPromptRow(row, []));

        return {
          prompts,
          page: query.page,
          pageSize: query.pageSize,
          total: totalRow.count,
        };
      },
    );
  }

  /**
   * Advanced search prompts with detailed match information, excerpts, and highlighting.
   * @param query - Search filters with advanced options.
   */
  public advancedSearchPrompts(query: {
    readonly text?: string;
    readonly formats?: readonly string[];
    readonly page: number;
    readonly pageSize: number;
    readonly caseSensitive: boolean;
    readonly maxResults: number;
    readonly maxMatchesPerRule: number;
    readonly maxTotalMatches: number;
    readonly category?: string;
  }): AdvancedPromptSearchResult {
    return this.telemetry.withSpan(
      "repository.advancedSearchPrompts",
      {
        text: query.text ?? "",
        formats: query.formats?.length ?? 0,
        page: query.page,
        caseSensitive: query.caseSensitive,
      },
      () => {
        const whereClauses: string[] = [];
        const parameters: Record<string, unknown> = {};

        const normalizedCategory = query.category?.trim();
        if (normalizedCategory) {
          whereClauses.push("p.category = @category");
          parameters.category = normalizedCategory;
        }

        const wantsFts = Boolean(query.text?.trim());
        const canUseFts = wantsFts && this.hasPromptsFts();

        if (query.text && canUseFts) {
          const ftsQuery = this.buildFtsQuery(query.text);
          if (ftsQuery) {
            whereClauses.push("prompts_fts MATCH @ftsQuery");
            parameters.ftsQuery = ftsQuery;
          }
        } else if (query.text) {
          whereClauses.push(
            "(p.title LIKE @text OR p.description LIKE @text OR pv.body LIKE @text)",
          );
          parameters.text = `%${query.text}%`;
        }

        if (query.formats && query.formats.length > 0) {
          whereClauses.push(
            `pv.format IN (${query.formats.map((_, index) => `@format${index}`).join(", ")})`,
          );
          query.formats.forEach((format, index) => {
            parameters[`format${index}`] = format;
          });
        }

        const whereClause =
          whereClauses.length > 0
            ? `WHERE ${whereClauses.join(" AND ")} AND p.deleted_at IS NULL`
            : "WHERE p.deleted_at IS NULL";

        const fromClause = canUseFts
          ? "FROM prompts p INNER JOIN prompts_fts ON prompts_fts.rowid = p.rowid"
          : "FROM prompts p";

        const totalRow = this.database
          .prepare(
            `SELECT COUNT(DISTINCT p.id) as count
             ${fromClause}
             LEFT JOIN prompt_versions pv ON pv.prompt_id = p.id
             ${whereClause}`,
          )
          .get(parameters) as { count: number };

        const orderByClause = canUseFts
          ? "ORDER BY bm25(prompts_fts) ASC, p.updated_at DESC"
          : "ORDER BY p.updated_at DESC";

        const rows = this.database
          .prepare(
            `SELECT p.id, p.slug, p.title, p.description, p.category, p.is_favorite, p.rating, p.created_at, p.updated_at, p.deleted_at,
                pv.id AS version_id, pv.semantic_version, pv.body, pv.format, pv.changelog,
                pv.created_at AS version_created_at, pv.updated_at AS version_updated_at
             ${fromClause}
             INNER JOIN prompt_versions pv ON pv.id = (
               SELECT id FROM prompt_versions
               WHERE prompt_id = p.id
               ORDER BY datetime(created_at) DESC, rowid DESC
               LIMIT 1
             )
             ${whereClause}
             ${orderByClause}
             LIMIT @limit OFFSET @offset`,
          )
          .all({
            ...parameters,
            limit: Math.min(query.pageSize, query.maxResults),
            offset: query.page * query.pageSize,
          }) as PromptRow[];

        const matches: PromptSearchMatch[] = [];
        let totalMatches = 0;

        for (const row of rows) {
          const prompt = this.mapPromptRow(row, []);
          const promptMatches = this.findMatchesInPrompt(
            prompt,
            query.text,
            query.caseSensitive,
            query.maxMatchesPerRule,
          );

          if (
            promptMatches.length > 0 &&
            totalMatches + promptMatches.length <= query.maxTotalMatches
          ) {
            matches.push({
              prompt,
              totalMatches: promptMatches.length,
              matches: promptMatches,
            });
            totalMatches += promptMatches.length;
          }

          if (
            matches.length >= query.maxResults ||
            totalMatches >= query.maxTotalMatches
          ) {
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
      },
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
    maxMatches: number = 3,
  ): SearchMatch[] {
    if (!searchText) {
      return [];
    }

    const matches: SearchMatch[] = [];
    const searchTerm = caseSensitive ? searchText : searchText.toLowerCase();
    const flags = caseSensitive ? "g" : "gi";
    const regex = new RegExp(
      searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      flags,
    );

    // Search in title
    if (prompt.title) {
      const text = caseSensitive ? prompt.title : prompt.title.toLowerCase();
      let match;
      while (
        (match = regex.exec(text)) !== null &&
        matches.length < maxMatches
      ) {
        matches.push(
          this.createMatchExcerpt(
            prompt.title,
            match.index,
            match[0].length,
            100,
          ),
        );
      }
    }

    // Search in description
    if (prompt.description) {
      const text = caseSensitive
        ? prompt.description
        : prompt.description.toLowerCase();
      let match;
      while (
        (match = regex.exec(text)) !== null &&
        matches.length < maxMatches
      ) {
        matches.push(
          this.createMatchExcerpt(
            prompt.description,
            match.index,
            match[0].length,
            100,
          ),
        );
      }
    }

    // Search in body
    if (prompt.latestVersion?.body) {
      const text = caseSensitive
        ? prompt.latestVersion.body
        : prompt.latestVersion.body.toLowerCase();
      let match;
      while (
        (match = regex.exec(text)) !== null &&
        matches.length < maxMatches
      ) {
        matches.push(
          this.createMatchExcerpt(
            prompt.latestVersion.body,
            match.index,
            match[0].length,
            150,
          ),
        );
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
  private createMatchExcerpt(
    text: string,
    position: number,
    length: number,
    contextLength: number,
  ): SearchMatch {
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
  public softDeletePrompt(
    promptId: PromptId,
    deletedAt: Date = new Date(),
  ): void {
    this.telemetry.withSpan("repository.softDeletePrompt", { promptId }, () => {
      // First check if the prompt exists and is not already deleted
      const existing = this.database
        .prepare(
          "SELECT id FROM prompts WHERE id = @promptId AND deleted_at IS NULL",
        )
        .get({ promptId }) as { id: string } | undefined;

      if (!existing) {
        this.logger.warn("repository_prompt_missing_or_deleted", { promptId });
        throw new PromptNotFoundError(promptId);
      }

      this.database
        .prepare(
          "UPDATE prompts SET deleted_at = @deletedAt WHERE id = @promptId",
        )
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
        .prepare(
          "SELECT id FROM prompts WHERE id = @promptId AND deleted_at IS NOT NULL",
        )
        .get({ promptId }) as { id: string } | undefined;

      if (!existing) {
        this.logger.warn("repository_prompt_missing_or_not_deleted", {
          promptId,
        });
        throw new PromptNotFoundError(promptId);
      }

      this.database
        .prepare("UPDATE prompts SET deleted_at = NULL WHERE id = @promptId")
        .run({ promptId });

      this.logger.info("prompt_restored", { promptId });
    });
  }

  /**
   * Update prompt metadata (title, description, category).
   * @param promptId - Identifier of the prompt to update.
   * @param data - Partial data to update.
   * @returns The updated prompt.
   */
  public updatePromptMetadata(
    promptId: PromptId,
    data: {
      title?: string;
      description?: string;
      category?: string;
      isFavorite?: boolean;
      rating?: number | null;
    },
  ): Prompt {
    return this.telemetry.withSpan(
      "repository.updatePromptMetadata",
      { promptId },
      () => {
        // First check if the prompt exists and is not deleted
        const existing = this.database
          .prepare(
            "SELECT id FROM prompts WHERE id = @promptId AND deleted_at IS NULL",
          )
          .get({ promptId }) as { id: string } | undefined;

        if (!existing) {
          this.logger.warn("repository_prompt_missing_for_update", {
            promptId,
          });
          throw new PromptNotFoundError(promptId);
        }

        const updates: string[] = [];
        const params: Record<
          string,
          string | number | boolean | null | undefined
        > = { promptId };

        if (data.title !== undefined) {
          updates.push("title = @title");
          params.title = data.title;
        }
        if (data.description !== undefined) {
          updates.push("description = @description");
          params.description = data.description;
        }
        if (data.category !== undefined) {
          updates.push("category = @category");
          params.category = data.category;
        }

        if (data.isFavorite !== undefined) {
          updates.push("is_favorite = @isFavorite");
          params.isFavorite = data.isFavorite ? 1 : 0;
        }

        if (data.rating !== undefined) {
          updates.push("rating = @rating");
          params.rating = data.rating;
        }

        if (updates.length > 0) {
          updates.push("updated_at = @updatedAt");
          params.updatedAt = new Date().toISOString();

          // Get current prompt data to recalculate integrity checksum
          const currentPrompt = this.database
            .prepare(
              "SELECT id, slug, title, description, category, is_favorite, rating FROM prompts WHERE id = @promptId",
            )
            .get({ promptId }) as {
              id: string;
              slug: string;
              title?: string;
              description?: string;
              category?: string;
              is_favorite: number;
              rating: number | null;
            };

          // Apply updates to get new data
          const updatedPrompt = {
            ...currentPrompt,
            ...data,
            is_favorite:
              data.isFavorite !== undefined
                ? data.isFavorite
                  ? 1
                  : 0
                : currentPrompt.is_favorite,
            rating:
              data.rating !== undefined ? data.rating : currentPrompt.rating,
          };

          // Recalculate integrity checksum
          const integrityChecksum = generateIntegrityChecksum(
            this.buildPromptChecksumPayload({
              id: updatedPrompt.id,
              slug: updatedPrompt.slug,
              title: updatedPrompt.title ?? null,
              description: updatedPrompt.description ?? null,
              category: updatedPrompt.category ?? null,
              isFavorite: updatedPrompt.is_favorite === 1,
              rating: updatedPrompt.rating ?? null,
            }),
          );

          updates.push("integrity_checksum = @integrityChecksum");
          params.integrityChecksum = integrityChecksum;

          this.database
            .prepare(
              `UPDATE prompts SET ${updates.join(", ")} WHERE id = @promptId`,
            )
            .run(params);

          this.logger.info("prompt_metadata_updated", {
            promptId,
            fields: Object.keys(data),
          });
        }

        return this.getPromptById(promptId);
      },
    );
  }

  /**
   * Get all soft deleted prompts.
   * @returns Array of deleted prompts with their metadata.
   */
  public getDeletedPrompts(): readonly Prompt[] {
    return this.telemetry.withSpan("repository.getDeletedPrompts", {}, () => {
      const rows = this.database
        .prepare(
          `SELECT p.id, p.slug, p.title, p.description, p.category, p.is_favorite, p.rating, p.created_at, p.updated_at, p.deleted_at,
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
           ORDER BY p.deleted_at DESC`,
        )
        .all() as PromptRow[];

      return rows.map((row) => this.mapPromptRow(row, []));
    });
  }

  /**
   * Permanently delete a prompt and all its associated data.
   * @param promptId - Identifier of the prompt to permanently delete.
   */
  public permanentlyDeletePrompt(promptId: PromptId): void {
    this.telemetry.withSpan(
      "repository.permanentlyDeletePrompt",
      { promptId },
      () => {
        this.runTransaction(() => {
          // Delete versions
          this.database
            .prepare("DELETE FROM prompt_versions WHERE prompt_id = @promptId")
            .run({ promptId });

          // Delete the prompt itself
          const result = this.database
            .prepare("DELETE FROM prompts WHERE id = @promptId")
            .run({ promptId });

          if (result.changes === 0) {
            this.logger.warn("repository_prompt_missing_for_deletion", {
              promptId,
            });
            throw new PromptNotFoundError(promptId);
          }

          this.logger.info("prompt_permanently_deleted", { promptId });
        });
      },
    );
  }

  /**
   * Record a new version for a prompt.
   * @param version - Version metadata to persist.
   */
  public addVersion(version: PromptVersion): void {
    this.telemetry.withSpan(
      "repository.addVersion",
      { promptId: version.promptId },
      () => {
        this.runTransaction(() => {
          this.insertVersionRecord(version);
          this.updatePromptTimestamps(
            version.promptId,
            version.updatedAt.toISOString(),
          );
        });
      },
    );
  }

  /**
   * List all versions for a prompt (most recent first).
   */
  public listPromptVersions(promptId: PromptId): readonly PromptVersion[] {
    return this.telemetry.withSpan(
      "repository.listPromptVersions",
      { promptId },
      () => {
        const exists = this.database
          .prepare("SELECT 1 as ok FROM prompts WHERE id = @promptId LIMIT 1")
          .get({ promptId }) as { ok?: number } | undefined;

        if (!exists?.ok) {
          throw new PromptNotFoundError(promptId);
        }

        const rows = this.database
          .prepare(
            `SELECT id, prompt_id, semantic_version, body, format, changelog, created_at, updated_at
           FROM prompt_versions
           WHERE prompt_id = @promptId
           ORDER BY datetime(created_at) DESC, rowid DESC`,
          )
          .all({ promptId }) as {
            id: string;
            prompt_id: string;
            semantic_version: string;
            body: string;
            format: string | null;
            changelog: string | null;
            created_at: string;
            updated_at: string;
          }[];

        return rows.map((row) => ({
          id: row.id,
          promptId: row.prompt_id,
          semanticVersion: row.semantic_version,
          body: row.body,
          format: (row.format as PromptFormat) ?? "markdown",
          changelog: row.changelog ?? undefined,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
        }));
      },
    );
  }

  /**
   * Upsert tags and attach them to a prompt. Preserves existing tag metadata when new payload omits it.
   */
  public upsertTags(promptId: PromptId, tags: readonly Tag[]): void {
    if (tags.length === 0) return;

    this.telemetry.withSpan(
      "repository.upsertTags",
      { promptId, count: tags.length },
      () => {
        const labelColumn = this.getTagLabelColumn();
        const descriptionColumn = this.hasColumn("tags", "description");
        const createdColumn = this.hasColumn("tags", "created_at");
        const updatedColumn = this.hasColumn("tags", "updated_at");

        this.runTransaction(() => {
          for (const tag of tags) {
            const existing = this.database
              .prepare(
                `SELECT id, ${labelColumn} as label, description FROM tags WHERE LOWER(${labelColumn}) = LOWER(@label) LIMIT 1`,
              )
              .get({ label: tag.label }) as
              | { id: string; label: string; description?: string | null }
              | undefined;

            const tagId = existing?.id ?? tag.id;
            const description = descriptionColumn
              ? (tag.description ?? existing?.description ?? null)
              : undefined;

            if (!existing) {
              const columns = ["id", labelColumn];
              const values = ["@id", "@label"];

              if (descriptionColumn) {
                columns.push("description");
                values.push("@description");
              }

              if (createdColumn) {
                columns.push("created_at");
                values.push("@createdAt");
              }

              if (updatedColumn) {
                columns.push("updated_at");
                values.push("@updatedAt");
              }

              this.database
                .prepare(
                  `INSERT INTO tags (${columns.join(", ")}) VALUES (${values.join(", ")})`,
                )
                .run({
                  id: tagId,
                  label: tag.label,
                  description,
                  createdAt:
                    (tag.createdAt ?? new Date()).toISOString?.() ??
                    new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                });
            } else if (
              descriptionColumn &&
              tag.description !== undefined &&
              tag.description !== null &&
              existing.description == null
            ) {
              const updates = ["description = @description"];
              if (updatedColumn) {
                updates.push("updated_at = @updatedAt");
              }

              this.database
                .prepare(`UPDATE tags SET ${updates.join(", ")} WHERE id = @id`)
                .run({
                  id: tagId,
                  description: tag.description,
                  updatedAt: new Date().toISOString(),
                });
            }

            this.database
              .prepare(
                "INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id) VALUES (@promptId, @tagId)",
              )
              .run({ promptId, tagId });
          }

          this.updatePromptTimestamps(promptId, new Date().toISOString());
        });
      },
    );
  }

  /**
   * Remove tags from a prompt and delete orphaned tags.
   */
  public removeTags(promptId: PromptId, labels: readonly string[]): void {
    if (labels.length === 0) return;

    this.telemetry.withSpan(
      "repository.removeTags",
      { promptId, count: labels.length },
      () => {
        const labelColumn = this.getTagLabelColumn();
        const lowerLabels = labels.map((label) => label.toLowerCase());

        this.runTransaction(() => {
          const placeholders = lowerLabels
            .map((_, index) => `@label${index}`)
            .join(", ");
          const params: Record<string, string> = {};
          lowerLabels.forEach((label, index) => {
            params[`label${index}`] = label;
          });

          const matchingTags = this.database
            .prepare(
              `SELECT id FROM tags WHERE LOWER(${labelColumn}) IN (${placeholders})`,
            )
            .all(params) as { id: string }[];

          const tagIds = matchingTags.map((row) => row.id);
          if (tagIds.length === 0) return;

          const tagPlaceholders = tagIds
            .map((_, index) => `@tag${index}`)
            .join(", ");
          const tagParams: Record<string, string> = { promptId };
          tagIds.forEach((id, index) => {
            tagParams[`tag${index}`] = id;
          });

          this.database
            .prepare(
              `DELETE FROM prompt_tags WHERE prompt_id = @promptId AND tag_id IN (${tagPlaceholders})`,
            )
            .run(tagParams);

          for (const tagId of tagIds) {
            const usage = this.database
              .prepare(
                "SELECT COUNT(*) as count FROM prompt_tags WHERE tag_id = @tagId",
              )
              .get({ tagId }) as { count: number };

            if (usage.count === 0) {
              this.database
                .prepare("DELETE FROM tags WHERE id = @tagId")
                .run({ tagId });
            }
          }

          this.updatePromptTimestamps(promptId, new Date().toISOString());
        });
      },
    );
  }

  // Migrations are handled by shared @nw/core-db; local migration runner removed.

  private insertPromptRecord(prompt: Prompt): void {
    // Generate integrity checksum for prompt metadata
    const integrityChecksum = generateIntegrityChecksum(
      this.buildPromptChecksumPayload({
        id: prompt.id,
        slug: prompt.slug,
        title: prompt.title ?? null,
        description: prompt.description ?? null,
        category: prompt.category ?? null,
        isFavorite: prompt.isFavorite ?? false,
        rating: prompt.rating ?? null,
      }),
    );

    const columns = [
      "id",
      "slug",
      "title",
      "description",
      "category",
      "integrity_checksum",
      "created_at",
      "updated_at",
    ];
    const values = [
      "@id",
      "@slug",
      "@title",
      "@description",
      "@category",
      "@integrityChecksum",
      "@createdAt",
      "@updatedAt",
    ];

    if (this.hasColumn("prompts", "is_favorite")) {
      columns.splice(5, 0, "is_favorite");
      values.splice(5, 0, "@isFavorite");
    }

    if (this.hasColumn("prompts", "rating")) {
      const insertIndex = columns.indexOf("integrity_checksum");
      columns.splice(insertIndex, 0, "rating");
      values.splice(insertIndex, 0, "@rating");
    }

    const statement = this.database.prepare(
      `INSERT INTO prompts (${columns.join(", ")})
       VALUES (${values.join(", ")})`,
    );

    statement.run({
      id: prompt.id,
      slug: prompt.slug,
      title: prompt.title,
      description: prompt.description ?? null,
      category: prompt.category ?? null,
      isFavorite: prompt.isFavorite ? 1 : 0,
      rating: prompt.rating ?? null,
      integrityChecksum,
      createdAt: prompt.createdAt.toISOString(),
      updatedAt: prompt.updatedAt.toISOString(),
    });
  }

  private insertVersionRecord(version: PromptVersion): void {
    // Generate integrity checksum for version content
    const integrityChecksum = generateIntegrityChecksum(version.body);

    const statement = this.database.prepare(
      `INSERT INTO prompt_versions (id, prompt_id, semantic_version, body, format, changelog, integrity_checksum, created_at, updated_at)
       VALUES (@id, @promptId, @semanticVersion, @body, @format, @changelog, @integrityChecksum, @createdAt, @updatedAt)`,
    );

    statement.run({
      id: version.id,
      promptId: version.promptId,
      semanticVersion: version.semanticVersion,
      body: version.body,
      format: version.format,
      changelog: version.changelog ?? null,
      integrityChecksum,
      createdAt: version.createdAt.toISOString(),
      updatedAt: version.updatedAt.toISOString(),
    });
  }

  private mapPromptRow(row: PromptRow, tags: readonly Tag[]): Prompt {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title ?? "",
      description: row.description ?? undefined,
      category: row.category ?? undefined,
      isFavorite: row.is_favorite === 1,
      rating: row.rating ?? undefined,
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

  private getTagsForPrompt(promptId: PromptId): Tag[] {
    const labelColumn = this.getTagLabelColumn();
    const hasDescription = this.hasColumn("tags", "description");
    const hasCreatedAt = this.hasColumn("tags", "created_at");

    const rows = this.database
      .prepare(
        `SELECT t.id as id, t.${labelColumn} as label, t.description as description, t.created_at as created_at
         FROM prompt_tags pt
         JOIN tags t ON t.id = pt.tag_id
         WHERE pt.prompt_id = @promptId`,
      )
      .all({ promptId }) as {
        id: string;
        label: string;
        description?: string | null;
        created_at?: string | null;
      }[];

    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      description: hasDescription ? (row.description ?? undefined) : undefined,
      createdAt:
        hasCreatedAt && row.created_at ? new Date(row.created_at) : new Date(),
    }));
  }

  /**
   * Return tags stored in the primary SQLite relationship tables.
   *
   * The service combines these with its shared-tag sidecar so recovery writes
   * remain visible without changing the ownership of either tag store.
   */
  public getStoredTagsForPrompt(promptId: PromptId): readonly Tag[] {
    return this.getTagsForPrompt(promptId);
  }

  public getAllTags(): Tag[] {
    const labelColumn = this.getTagLabelColumn();
    const hasDescription = this.hasColumn("tags", "description");
    const hasCreatedAt = this.hasColumn("tags", "created_at");
    const hasUpdatedAt = this.hasColumn("tags", "updated_at");

    const rows = this.database
      .prepare(
        `SELECT id, ${labelColumn} as label${hasDescription ? ", description" : ""}${hasCreatedAt ? ", created_at" : ""}${hasUpdatedAt ? ", updated_at" : ""}
         FROM tags`,
      )
      .all() as {
        id: string;
        label: string;
        description?: string | null;
        created_at?: string | null;
        updated_at?: string | null;
      }[];

    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      description: hasDescription ? (row.description ?? undefined) : undefined,
      createdAt:
        hasCreatedAt && row.created_at ? new Date(row.created_at) : new Date(),
      updatedAt:
        hasUpdatedAt && row.updated_at ? new Date(row.updated_at) : undefined,
    }));
  }

  private updatePromptTimestamps(promptId: PromptId, isoDate: string): void {
    this.database
      .prepare(
        `UPDATE prompts SET updated_at = @updatedAt WHERE id = @promptId`,
      )
      .run({ promptId, updatedAt: isoDate });
  }

  private buildPromptChecksumPayload(prompt: {
    id: string;
    slug: string;
    title: string | null;
    description: string | null;
    category: string | null;
    isFavorite: boolean;
    rating: number | null;
  }): string {
    return JSON.stringify({
      id: prompt.id,
      slug: prompt.slug,
      title: prompt.title,
      description: prompt.description,
      category: prompt.category,
      isFavorite: prompt.isFavorite,
      rating: prompt.rating,
    });
  }

  public touchPrompt(promptId: PromptId, updatedAt: Date = new Date()): void {
    this.updatePromptTimestamps(promptId, updatedAt.toISOString());
  }

  public getDatabase(): BetterSqlite3Database {
    return this.database;
  }

  public getMigrationState(): {
    migrationsDir: string;
    userVersion: number;
    inferredVersion: number;
    currentVersion: number;
    latestVersion: number;
    pendingVersions: readonly number[];
    appliedVersions: readonly number[];
  } {
    const migrationsDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "db",
      "migrations",
    );
    const userVersion = this.database.pragma("user_version", {
      simple: true,
    }) as number;
    const inferredVersion = this.inferSchemaVersion();
    const currentVersion = Math.max(userVersion, inferredVersion);

    const migrations = readdirSync(migrationsDir)
      .map((file) => {
        const match = file.match(/^(\d+)_.*\.sql$/);
        if (!match) return null;
        return {
          version: Number.parseInt(match[1], 10),
          path: join(migrationsDir, file),
        };
      })
      .filter((entry): entry is { version: number; path: string } =>
        Boolean(entry),
      )
      .sort((a, b) => a.version - b.version);

    const latestVersion = migrations.at(-1)?.version ?? 0;
    const pendingVersions = [
      ...new Set(
        migrations
          .filter((migration) => migration.version > currentVersion)
          .map((migration) => migration.version),
      ),
    ];
    const appliedVersions = [
      ...new Set(
        migrations
          .filter((migration) => migration.version <= currentVersion)
          .map((migration) => migration.version),
      ),
    ];

    return {
      migrationsDir,
      userVersion,
      inferredVersion,
      currentVersion,
      latestVersion,
      pendingVersions,
      appliedVersions,
    };
  }

  /**
   * Get all prompts (including deleted ones for diagnostics).
   * @returns Array of all prompts with their metadata.
   */
  public getAllPrompts(): readonly Prompt[] {
    return this.telemetry.withSpan("repository.getAllPrompts", {}, () => {
      const rows = this.database
        .prepare(
          `SELECT p.id, p.slug, p.title, p.description, p.category, p.is_favorite, p.rating, p.created_at, p.updated_at, p.deleted_at,
                  pv.id AS version_id, pv.semantic_version, pv.body, pv.format, pv.changelog,
                  pv.created_at AS version_created_at, pv.updated_at AS version_updated_at
           FROM prompts p
           LEFT JOIN prompt_versions pv ON pv.id = (
             SELECT id FROM prompt_versions
             WHERE prompt_id = p.id
             ORDER BY datetime(created_at) DESC, rowid DESC
             LIMIT 1
           )
           ORDER BY p.created_at DESC`,
        )
        .all() as PromptRow[];

      return rows.map((row) => this.mapPromptRow(row, []));
    });
  }

  /**
   * Update the format of a specific version.
   * @param versionId - ID of the version to update.
   * @param format - New format for the version.
   */
  public updateVersionFormat(versionId: string, format: PromptFormat): void {
    this.telemetry.withSpan(
      "repository.updateVersionFormat",
      { versionId, format },
      () => {
        const result = this.database
          .prepare(
            "UPDATE prompt_versions SET format = @format WHERE id = @versionId",
          )
          .run({ versionId, format });

        if (result.changes === 0) {
          throw new Error(`Version not found: ${versionId}`);
        }

        this.logger.info("version_format_updated", { versionId, format });
      },
    );
  }

  private runTransaction<T>(operation: () => T): T {
    return this.database.transaction(operation)();
  }

  private getTagLabelColumn(): "label" | "name" {
    return this.hasColumn("tags", "label") ? "label" : "name";
  }

  public hasTable(table: string): boolean {
    const row = this.database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = @table LIMIT 1",
      )
      .get({ table }) as { name?: string } | undefined;
    return Boolean(row?.name);
  }

  private applyMigrations(): void {
    const migrationsDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "db",
      "migrations",
    );
    const storedVersion = this.database.pragma("user_version", {
      simple: true,
    }) as number;
    const inferredVersion = this.inferSchemaVersion();
    const currentVersion = Math.max(storedVersion, inferredVersion);
    const migrations = readdirSync(migrationsDir)
      .map((file) => {
        const match = file.match(/^(\d+)_.*\.sql$/);
        if (!match) return null;
        return {
          version: Number.parseInt(match[1], 10),
          path: join(migrationsDir, file),
        };
      })
      .filter((entry): entry is { version: number; path: string } =>
        Boolean(entry),
      )
      .sort((a, b) => a.version - b.version);

    const pending = migrations.filter(
      (migration) => migration.version > currentVersion,
    );
    this.database.exec("PRAGMA foreign_keys = ON;");

    if (pending.length === 0) {
      if (storedVersion !== currentVersion) {
        this.database.pragma(`user_version = ${currentVersion}`);
      }
      return;
    }

    this.telemetry.withSpan(
      "repository.applyMigrations",
      { from: currentVersion, to: pending.at(-1)?.version ?? currentVersion },
      () => {
        for (const migration of pending) {
          const sql = readFileSync(migration.path, "utf8");

          if (
            sql.includes("ALTER TABLE prompts ADD COLUMN category") &&
            this.hasColumn("prompts", "category")
          ) {
            this.database.pragma(`user_version = ${migration.version}`);
            continue;
          }

          if (
            sql.includes("ALTER TABLE prompts ADD COLUMN deleted_at") &&
            this.hasColumn("prompts", "deleted_at")
          ) {
            this.database.pragma(`user_version = ${migration.version}`);
            continue;
          }

          if (
            sql.includes("ALTER TABLE prompt_versions ADD COLUMN format") &&
            this.hasColumn("prompt_versions", "format")
          ) {
            this.database.pragma(`user_version = ${migration.version}`);
            continue;
          }

          if (
            sql.includes("ALTER TABLE prompts ADD COLUMN is_favorite") &&
            this.hasColumn("prompts", "is_favorite")
          ) {
            this.database.pragma(`user_version = ${migration.version}`);
            continue;
          }

          if (
            sql.includes("ALTER TABLE prompts ADD COLUMN rating") &&
            this.hasColumn("prompts", "rating")
          ) {
            this.database.pragma(`user_version = ${migration.version}`);
            continue;
          }

          this.database.exec(sql);
          this.database.pragma(`user_version = ${migration.version}`);
        }
        this.logger.info("migrations_applied", {
          applied: pending.length,
          targetVersion: pending.at(-1)?.version ?? currentVersion,
        });
      },
    );
  }

  private hasColumn(table: string, column: string): boolean {
    const columns = this.database
      .prepare(`PRAGMA table_info(${table})`)
      .all() as { name: string }[];
    return columns.some((definition) => definition.name === column);
  }

  private inferSchemaVersion(): number {
    try {
      const promptColumns = this.database
        .prepare("PRAGMA table_info(prompts)")
        .all() as { name: string }[];
      const promptVersionColumns = this.database
        .prepare("PRAGMA table_info(prompt_versions)")
        .all() as { name: string }[];
      const hasCategory = promptColumns.some(
        (column) => column.name === "category",
      );
      const hasDeletedAt = promptColumns.some(
        (column) => column.name === "deleted_at",
      );
      const hasFavorite = promptColumns.some(
        (column) => column.name === "is_favorite",
      );
      const hasRating = promptColumns.some(
        (column) => column.name === "rating",
      );
      const hasFormat = promptVersionColumns.some(
        (column) => column.name === "format",
      );

      if (
        hasCategory &&
        hasDeletedAt &&
        hasFormat &&
        hasFavorite &&
        hasRating
      ) {
        return 5;
      }

      if (hasCategory && hasDeletedAt && hasFormat) {
        return 2;
      }

      if (promptColumns.length > 0 || promptVersionColumns.length > 0) {
        return 1;
      }

      return 0;
    } catch {
      return 0;
    }
  }
}
