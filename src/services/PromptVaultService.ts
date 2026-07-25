import { randomUUID } from "node:crypto";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { z, type ZodIssue } from "zod";
import type {
  Prompt,
  PromptId,
  PromptSearchResult,
  PromptVersion,
  Tag,
  PromptFormat,
  AdvancedPromptSearchResult,
} from "../domain/models.js";
import { ValidationError } from "../domain/errors.js";
import { promptInputSchema, searchQuerySchema } from "../domain/validation.js";
import { PromptRepository } from "../repositories/PromptRepository.js";
import type { Telemetry } from "../observability/telemetry.js";
import { createNoopTelemetry } from "../observability/telemetry.js";
import type { StructuredLogger } from "../observability/logger.js";
import { createLoggerFromEnv } from "../observability/logger.js";
import { PluginHost } from "../extensions/PluginHost.js";
import type { PromptVaultPlugin } from "../extensions/types.js";
import {
  convertPromptContent,
  validatePromptContent,
  detectPromptFormat,
} from "../domain/conversion.js";
import { SnapshotManager } from "../domain/snapshot.js";
import {
  buildButtonsSwitchboardPayload,
  buildPlannerBucketDraft,
  type ButtonsSwitchboardPayload,
  type PlannerBucketDraft,
} from "../domain/interop.js";
import fs from "fs";
import os from "node:os";
import path from "path";
import yaml from "yaml";
import { emitPromptEvent } from "../lib/nw-bridge.js";
import {
  createSharedTag,
  getTagById,
  listSharedTags,
  listSharedTagsForEntity,
  listSharedEntitiesByTags,
  resetCoreDb,
  tagSharedPrompt,
  untagSharedPrompt,
} from "../lib/platform-core.js";
import type { SharedTag } from "../lib/platform-core.js";

export interface PromptVaultServiceOptions {
  readonly telemetry?: Telemetry;
  readonly logger?: StructuredLogger;
  readonly plugins?: readonly PromptVaultPlugin[];
  readonly limits?: {
    readonly maxFileSizeBytes: number;
    readonly maxPromptContentLength: number;
  };
}

export interface PromptVaultOperationContext {
  readonly actor?: {
    readonly userId?: string;
    readonly requestId?: string;
  };
}

/**
 * High-level façade orchestrating prompt workflows and validation.
 */
export class PromptVaultService {
  private readonly repository: PromptRepository;

  private readonly telemetry: Telemetry;

  private readonly logger: StructuredLogger;

  private readonly pluginHost: PluginHost;

  private readonly limits: {
    readonly maxFileSizeBytes: number;
    readonly maxPromptContentLength: number;
  };

  private coreDbReady: Promise<void> | null = null;

  public constructor(
    database: BetterSqlite3Database,
    options: PromptVaultServiceOptions = {},
  ) {
    const dbPath = (database as { name?: string }).name;
    if (dbPath) {
      process.env.NW_CORE_DB_ALLOW_OVERRIDE = "1";
      const coreDbPath =
        dbPath === ":memory:"
          ? path.join(os.tmpdir(), `nw-core-${randomUUID()}.db`)
          : `${dbPath}.core.db`;
      process.env.NW_CORE_DB_PATH = coreDbPath;
    }

    this.telemetry = options.telemetry ?? createNoopTelemetry();
    this.logger =
      options.logger ??
      createLoggerFromEnv({ serviceName: "prompt-vault-service" });
    this.repository = new PromptRepository(database, {
      telemetry: this.telemetry,
      logger: this.logger,
    });
    this.pluginHost = new PluginHost({
      logger: this.logger.child({ component: "plugin-host" }),
      telemetry: this.telemetry,
    });

    this.coreDbReady = resetCoreDb().catch(() => undefined);

    this.limits = options.limits ?? {
      maxFileSizeBytes: 10 * 1024 * 1024, // 10MB
      maxPromptContentLength: 100 * 1024, // 100KB
    };

    for (const plugin of options.plugins ?? []) {
      this.pluginHost.register(plugin);
    }
  }

  /**
   * List all prompts (excluding soft-deleted ones) with their latest version metadata.
   *
   * This is intended for export/interop flows where a complete snapshot is needed
   * (e.g., generating payloads for other apps). It avoids pagination and returns
   * the newest version per prompt.
   */
  public async listAllPrompts(): Promise<readonly Prompt[]> {
    return this.telemetry.withSpan("service.listAllPrompts", {}, async () => {
      const prompts = this.repository
        .getAllPrompts()
        .filter((prompt) => !prompt.deletedAt);

      return Promise.all(
        prompts.map((prompt) => this.enrichPromptWithTags(prompt)),
      );
    });
  }

  /**
   * Create a prompt with an initial version and optional tags.
   *
   * This method validates the input data, creates both a prompt entity and its initial version,
   * applies tag normalization and deduplication, and persists everything to the database.
   * It also triggers plugin events and telemetry tracking for the creation operation.
   *
   * @param input - User-supplied prompt payload containing all required fields
   * @returns The newly created and persisted prompt with all associated data
   * @throws ValidationError if the input data fails schema validation
   * @throws ValidationError if the prompt content format is invalid
   * @throws DuplicatePromptError if a prompt with the same slug already exists
   *
   * @example
   * ```typescript
   * const prompt = service.createPrompt({
   *   id: randomUUID(),
   *   slug: "greeting-prompt",
   *   title: "Greeting Prompt",
   *   description: "A friendly greeting prompt",
   *   body: "Hello! How can I help you today?",
   *   semanticVersion: "1.0.0",
   *   format: "markdown",
   *   tags: ["greeting", "customer-service"],
   *   changelog: "Initial version"
   * });
   * ```
   */
  public async createPrompt(
    input: z.input<typeof promptInputSchema>,
    context: PromptVaultOperationContext = {},
  ): Promise<Prompt> {
    return this.telemetry.withSpan(
      "service.createPrompt",
      { slug: input.slug },
      async () => {
        const result = promptInputSchema.safeParse(input);
        if (!result.success) {
          throw new ValidationError(
            result.error.issues.map((error: ZodIssue) => error.message),
          );
        }

        const {
          id,
          slug,
          title,
          description,
          category,
          isFavorite,
          rating,
          body,
          semanticVersion,
          tags,
          projectTagId,
          changelog,
          format,
        } = result.data;

        validatePromptContent(body, format);

        if (projectTagId) {
          await this.assertProjectTagExists(projectTagId);
        }

        const timestamp = new Date();
        const prompt: Prompt = {
          id,
          slug,
          title,
          description,
          category,
          isFavorite,
          rating,
          tags: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        const version: PromptVersion = {
          id: randomUUID(),
          promptId: id,
          semanticVersion,
          body,
          format,
          changelog,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        this.repository.createPrompt(prompt, version);

        const sharedTags = await this.ensureSharedTags(tags ?? []);
        await this.applyTagsToPrompt(
          id,
          sharedTags.map((tag) => tag.id),
        );

        if (projectTagId) {
          await tagSharedPrompt(id, projectTagId);
        }

        const persisted = await this.enrichPromptWithTags(
          this.repository.getPromptById(id),
        );
        this.logger.info("prompt_created", { promptId: persisted.id, slug });
        this.pluginHost.emit("onPromptCreated", {
          prompt: persisted,
          version,
          actor: context.actor,
        });
        emitPromptEvent("pv:prompt_created", {
          promptId: persisted.id,
          actorUserId: context.actor?.userId,
          requestId: context.actor?.requestId,
        });
        return persisted;
      },
    );
  }

  /**
   * Retrieve a prompt by identifier.
   *
   * Fetches a complete prompt entity including all associated tags, versions,
   * and metadata. This is the primary method for accessing prompt data.
   *
   * @param promptId - Unique identifier of the prompt to retrieve
   * @returns The complete prompt entity with all associated data
   * @throws PromptNotFoundError if no prompt exists with the given ID
   *
   * @example
   * ```typescript
   * const prompt = service.getPrompt("550e8400-e29b-41d4-a716-446655440000");
   * console.log(prompt.title); // "Greeting Prompt"
   * console.log(prompt.tags.length); // 2
   * ```
   */
  public async getPrompt(promptId: PromptId): Promise<Prompt> {
    const prompt = this.repository.getPromptById(promptId);
    return this.enrichPromptWithTags(prompt);
  }

  /**
   * Update a prompt's metadata and optionally its tags.
   *
   * This method updates the prompt's title, description, category, and/or tags.
   * It validates input data and updates timestamps accordingly.
   *
   * @param promptId - Unique identifier of the prompt to update
   * @param data - Partial update data (title, description, category, tags)
   * @returns The updated prompt entity with all associated data
   * @throws PromptNotFoundError if no active prompt exists with the given ID
   * @throws ValidationError if the input data fails schema validation
   *
   * @example
   * ```typescript
   * const updated = service.updatePrompt("550e8400-e29b-41d4-a716-446655440000", {
   *   title: "Updated Title",
   *   tags: ["new-tag", "updated"]
   * });
   * ```
   */
  public async updatePrompt(
    promptId: PromptId,
    data: {
      title?: string;
      description?: string;
      category?: string;
      isFavorite?: boolean;
      rating?: number | null;
      tags?: readonly string[];
      projectTagId?: string;
    },
    context: PromptVaultOperationContext = {},
  ): Promise<Prompt> {
    return this.telemetry.withSpan(
      "service.updatePrompt",
      { promptId },
      async () => {
        const metadataUpdates: {
          title?: string;
          description?: string;
          category?: string;
          isFavorite?: boolean;
          rating?: number | null;
        } = {};
        if (data.title !== undefined) metadataUpdates.title = data.title;
        if (data.description !== undefined)
          metadataUpdates.description = data.description;
        if (data.category !== undefined)
          metadataUpdates.category = data.category;
        if (data.isFavorite !== undefined)
          metadataUpdates.isFavorite = data.isFavorite;
        if (data.rating !== undefined) metadataUpdates.rating = data.rating;

        if (Object.keys(metadataUpdates).length > 0) {
          this.repository.updatePromptMetadata(promptId, metadataUpdates);
        }

        if (data.tags !== undefined) {
          const desiredTags = await this.ensureSharedTags(data.tags);
          const current = await listSharedTagsForEntity({
            entityType: "prompts",
            entityId: promptId,
          });
          const currentIds = new Set(current.map((tag) => tag.id));
          const desiredIds = new Set(desiredTags.map((tag) => tag.id));

          const toAdd = [...desiredIds].filter((id) => !currentIds.has(id));
          const toRemove = [...currentIds].filter((id) => !desiredIds.has(id));

          for (const tagId of toAdd) {
            await tagSharedPrompt(promptId, tagId);
          }

          for (const tagId of toRemove) {
            await untagSharedPrompt(promptId, tagId);
          }
        }

        if (data.projectTagId) {
          await this.assertProjectTagExists(data.projectTagId);
          await tagSharedPrompt(promptId, data.projectTagId);
        }

        const updatedPrompt = await this.getPrompt(promptId);
        const updatedFields = Object.entries(data)
          .filter(([, value]) => value !== undefined)
          .map(([key]) => key);

        this.logger.info("prompt_updated", { promptId, fields: updatedFields });
        this.pluginHost.emit("onPromptUpdated", {
          prompt: updatedPrompt,
          updatedFields,
          actor: context.actor,
        });
        emitPromptEvent("pv:prompt_updated", {
          promptId,
          actorUserId: context.actor?.userId,
          requestId: context.actor?.requestId,
        });
        return updatedPrompt;
      },
    );
  }

  /**
   * Append a new version to an existing prompt.
   *
   * Creates a new version of an existing prompt with updated content. The version
   * is validated for format and size constraints before being persisted. This
   * enables version control and change tracking for prompt evolution.
   *
   * @param promptId - Unique identifier of the prompt to update
   * @param body - New prompt body text content
   * @param semanticVersion - Semantic version string (e.g., "1.1.0", "2.0.0-beta")
   * @param format - Format of the prompt content (defaults to "markdown")
   * @param changelog - Optional description of changes in this version
   * @returns The newly created version entity
   * @throws PromptNotFoundError if the prompt doesn't exist
   * @throws ValidationError if content exceeds size limits or format is invalid
   *
   * @example
   * ```typescript
   * const newVersion = service.addVersion(
   *   "550e8400-e29b-41d4-a716-446655440000",
   *   "Hello! How may I assist you today?",
   *   "1.1.0",
   *   "markdown",
   *   "Improved greeting language"
   * );
   * ```
   */
  public addVersion(
    promptId: PromptId,
    body: string,
    semanticVersion: string,
    format: PromptFormat = "markdown",
    changelog?: string,
  ): PromptVersion {
    // Ensure the prompt exists; repository will throw PromptNotFoundError otherwise.
    return this.telemetry.withSpan("service.addVersion", { promptId }, () => {
      this.repository.getPromptById(promptId);

      // Check content length
      if (body.length > this.limits.maxPromptContentLength) {
        throw new ValidationError([
          `Prompt content length ${body.length} characters exceeds maximum allowed length of ${this.limits.maxPromptContentLength} characters`,
        ]);
      }

      // Validate content format
      validatePromptContent(body, format);

      const timestamp = new Date();
      const version: PromptVersion = {
        id: randomUUID(),
        promptId,
        semanticVersion,
        body,
        format,
        changelog,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      this.repository.addVersion(version);
      this.logger.info("prompt_version_added", {
        promptId,
        version: semanticVersion,
      });
      this.pluginHost.emit("onVersionAdded", { promptId, version });
      emitPromptEvent("pv:prompt_updated", { promptId });
      return version;
    });
  }

  /**
   * List all versions for a prompt (most recent first).
   */
  public listPromptVersions(promptId: PromptId): readonly PromptVersion[] {
    return this.telemetry.withSpan(
      "service.listPromptVersions",
      { promptId },
      () => {
        return this.repository.listPromptVersions(promptId);
      },
    );
  }

  /**
   * Convert a prompt's content to a different format.
   * @param promptId - Identifier of the prompt.
   * @param targetFormat - The desired output format.
   * @returns The converted content.
   */
  public async convertPrompt(
    promptId: PromptId,
    targetFormat: PromptFormat,
  ): Promise<string> {
    return this.telemetry.withSpan(
      "service.convertPrompt",
      { promptId, targetFormat },
      async () => {
        const prompt = this.repository.getPromptById(promptId);
        if (!prompt.latestVersion) {
          throw new ValidationError(["Prompt has no versions to convert"]);
        }

        const converted = convertPromptContent(
          prompt.latestVersion.body,
          prompt.latestVersion.format,
          targetFormat,
        );

        this.logger.info("prompt_converted", {
          promptId,
          from: prompt.latestVersion.format,
          to: targetFormat,
        });
        return converted;
      },
    );
  }

  /**
   * Create a compressed snapshot of the database.
   * @param snapshotPath - Path where the compressed snapshot should be saved.
   * @returns Promise that resolves when backup is complete.
   */
  public async createSnapshot(snapshotPath: string): Promise<void> {
    return this.telemetry.withSpan(
      "service.createSnapshot",
      { snapshotPath },
      async () => {
        await SnapshotManager.createSnapshot(
          this.repository.getDatabase(),
          snapshotPath,
        );
        this.logger.info("snapshot_created", { snapshotPath });
      },
    );
  }

  /**
   * Restore database from a compressed snapshot.
   * @param snapshotPath - Path to the compressed snapshot file.
   * @returns Promise that resolves when restore is complete.
   */
  public async restoreSnapshot(snapshotPath: string): Promise<void> {
    return this.telemetry.withSpan(
      "service.restoreSnapshot",
      { snapshotPath },
      async () => {
        await SnapshotManager.restoreSnapshot(
          snapshotPath,
          this.repository.getDatabase(),
        );
        this.logger.info("snapshot_restored", { snapshotPath });
      },
    );
  }

  /**
   * Get information about a snapshot file.
   * @param snapshotPath - Path to the snapshot file.
   * @returns Promise resolving to snapshot metadata.
   */
  public async getSnapshotInfo(snapshotPath: string): Promise<{
    size: number;
    created: Date;
    compressed: boolean;
  }> {
    return SnapshotManager.getSnapshotInfo(snapshotPath);
  }

  /**
   * Validate that a snapshot file is readable and appears to be a valid database dump.
   * @param snapshotPath - Path to the snapshot file.
   * @returns Promise resolving to true if valid, false otherwise.
   */
  public async validateSnapshot(snapshotPath: string): Promise<boolean> {
    return SnapshotManager.validateSnapshot(snapshotPath);
  }

  /**
   * Search prompts using fuzzy text, tag, and format filters.
   *
   * Performs a comprehensive search across prompt titles, descriptions, content,
   * and tags using fuzzy matching. Supports filtering by tags and content formats.
   * Returns basic prompt information without detailed match excerpts.
   *
   * @param queryInput - Search query parameters including text, tags, and format filters
   * @returns Search results containing matching prompts and basic metadata
   * @throws ValidationError if query parameters are invalid
   *
   * @example
   * ```typescript
   * const results = service.searchPrompts({
   *   text: "greeting customer",
   *   tags: ["customer-service"],
   *   formats: ["markdown"]
   * });
   * console.log(`Found ${results.prompts.length} prompts`);
   * ```
   */
  public async searchPrompts(
    queryInput: z.input<typeof searchQuerySchema>,
  ): Promise<PromptSearchResult> {
    return this.telemetry.withSpan(
      "service.searchPrompts",
      {
        hasText: Boolean(queryInput.text),
        hasFormats: Boolean(queryInput.formats),
        hasProjectTag: Boolean(queryInput.projectTagId),
      },
      async () => {
        const query = searchQuerySchema.parse(queryInput);
        this.logger.debug("prompt_search", {
          hasText: Boolean(query.text),
          tags: query.tags?.length ?? 0,
          formats: query.formats?.length ?? 0,
          category: query.category,
          projectTagId: query.projectTagId,
        });

        const tagIds = query.tags
          ? await this.lookupTagIds(query.tags, { createIfMissing: false })
          : undefined;
        const filterSets: Array<Set<string>> = [];

        if (tagIds && tagIds.length > 0) {
          const ids = await listSharedEntitiesByTags({
            entityType: "prompts",
            tagIds,
            match: "all",
          });
          filterSets.push(new Set(ids));
        }

        if (query.projectTagId) {
          const projectMatches = await listSharedEntitiesByTags({
            entityType: "prompts",
            tagIds: [query.projectTagId],
            match: "all",
          });
          filterSets.push(new Set(projectMatches));
        }

        const allowedIds = filterSets.reduce<Set<string> | null>(
          (acc, current) => {
            if (!acc) return current;
            return new Set([...acc].filter((id) => current.has(id)));
          },
          null,
        );

        if (allowedIds && allowedIds.size === 0) {
          return {
            prompts: [],
            page: query.page,
            pageSize: query.pageSize,
            total: 0,
          };
        }

        const base = this.repository.searchPrompts({
          text: query.text,
          formats: query.formats,
          page: query.page,
          pageSize: query.pageSize,
          category: query.category,
        });

        const promptsWithTags = await Promise.all(
          base.prompts.map((prompt) => this.enrichPromptWithTags(prompt)),
        );
        const filteredPrompts = allowedIds
          ? promptsWithTags.filter((prompt) => allowedIds.has(prompt.id))
          : promptsWithTags;

        return {
          prompts: filteredPrompts,
          page: query.page,
          pageSize: query.pageSize,
          total: allowedIds ? filteredPrompts.length : base.total,
        };
      },
    );
  }

  /**
   * Export a Buttons switchboard payload from a set of prompts.
   * Intended to be copy/pasted into the Buttons app without coupling.
   */
  public exportButtonsSwitchboard(
    prompts: readonly Prompt[],
    limit = 12,
  ): ButtonsSwitchboardPayload | null {
    return buildButtonsSwitchboardPayload(prompts, limit);
  }

  /**
   * Export a Planner bucket draft seeded with prompt bodies.
   */
  public exportPlannerBucket(
    prompts: readonly Prompt[],
    limit = 10,
  ): PlannerBucketDraft | null {
    return buildPlannerBucketDraft(prompts, limit);
  }

  public async exportPromptBundle(options: {
    readonly format: "json" | "yaml";
    readonly promptIds?: readonly PromptId[];
    readonly includeMetadata?: boolean;
  }): Promise<{
    bundle: Record<string, unknown>;
    content: string;
    mimeType: string;
  }> {
    return this.telemetry.withSpan(
      "service.exportPromptBundle",
      { format: options.format },
      async () => {
        const prompts = await this.listAllPrompts();
        const selected =
          options.promptIds && options.promptIds.length > 0
            ? prompts.filter((prompt) => options.promptIds?.includes(prompt.id))
            : prompts;

        await this.ensureCoreDb();
        const exportedPrompts = await Promise.all(
          selected
            .filter((prompt) => prompt.latestVersion)
            .map(async (prompt) => {
              const sharedTags = await listSharedTagsForEntity({
                entityType: "prompts",
                entityId: prompt.id,
              });
              const projectTag = sharedTags.find(
                (tag) => tag.kind === "project",
              );
              const labelTags = sharedTags
                .filter((tag) => tag.kind !== "project")
                .map((tag) => tag.name);

              return {
                slug: prompt.slug,
                title: prompt.title,
                description: prompt.description ?? undefined,
                category: prompt.category ?? undefined,
                body: prompt.latestVersion?.body ?? "",
                format: prompt.latestVersion?.format ?? "markdown",
                semanticVersion:
                  prompt.latestVersion?.semanticVersion ?? "1.0.0",
                tags: labelTags,
                projectTagId: projectTag?.id ?? undefined,
              };
            }),
        );

        const bundle = {
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          prompts: exportedPrompts,
          ...(options.includeMetadata
            ? {
                metadata: {
                  source: "prompt-vault",
                },
              }
            : {}),
        } as const;

        if (options.format === "yaml") {
          return {
            bundle: bundle as unknown as Record<string, unknown>,
            content: yaml.stringify(bundle),
            mimeType: "text/yaml",
          };
        }

        return {
          bundle: bundle as unknown as Record<string, unknown>,
          content: JSON.stringify(bundle, null, 2),
          mimeType: "application/json",
        };
      },
    );
  }

  public async exportPromptBundleToFile(
    filePath: string,
    options: {
      readonly format: "json" | "yaml";
      readonly promptIds?: readonly PromptId[];
      readonly includeMetadata?: boolean;
    },
  ): Promise<void> {
    return this.telemetry.withSpan(
      "service.exportPromptBundleToFile",
      { filePath, format: options.format },
      async () => {
        const { content } = await this.exportPromptBundle(options);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, content, "utf-8");
        this.logger.info("prompt_bundle_exported", {
          filePath,
          format: options.format,
        });
      },
    );
  }

  public async importPromptBundle(input: {
    readonly format: "json" | "yaml";
    readonly content: string;
    readonly conflictStrategy?: "skip" | "addVersion";
    readonly projectTagId?: string;
  }): Promise<{ created: number; updated: number; skipped: number }> {
    return this.telemetry.withSpan(
      "service.importPromptBundle",
      {
        format: input.format,
        conflictStrategy: input.conflictStrategy ?? "addVersion",
      },
      async () => {
        const bundleSchema = z.object({
          schemaVersion: z.number().int().optional(),
          exportedAt: z.string().optional(),
          prompts: z.array(
            z.object({
              slug: z.string().min(3),
              title: z.string().min(1),
              description: z.string().optional(),
              category: z.string().optional(),
              body: z.string().min(1),
              format: z.enum(["markdown", "yaml", "json"]).default("markdown"),
              semanticVersion: z
                .string()
                .regex(/^[0-9]+\.[0-9]+\.[0-9]+$/)
                .default("1.0.0"),
              tags: z.array(z.string()).default([]),
              projectTagId: z.string().uuid().optional(),
            }),
          ),
          metadata: z.record(z.string(), z.unknown()).optional(),
        });

        let parsed: unknown;
        try {
          parsed =
            input.format === "yaml"
              ? yaml.parse(input.content)
              : JSON.parse(input.content);
        } catch (error: unknown) {
          throw new ValidationError([
            `Unable to parse ${input.format.toUpperCase()} prompt bundle: ${error instanceof Error ? error.message : String(error)}`,
          ]);
        }

        const bundle = bundleSchema.parse(parsed);
        const conflictStrategy = input.conflictStrategy ?? "addVersion";
        const projectTagId = input.projectTagId?.trim()
          ? input.projectTagId.trim()
          : undefined;
        if (projectTagId) {
          await this.assertProjectTagExists(projectTagId);
        }

        let created = 0;
        let updated = 0;
        let skipped = 0;

        for (const prompt of bundle.prompts) {
          const resolvedProjectTagId = prompt.projectTagId ?? projectTagId;
          const existingId = this.repository.getPromptIdBySlug(prompt.slug);
          if (!existingId) {
            await this.createPrompt({
              id: randomUUID(),
              slug: prompt.slug,
              title: prompt.title,
              description: prompt.description,
              category: prompt.category,
              body: prompt.body,
              format: prompt.format,
              semanticVersion: prompt.semanticVersion,
              tags: prompt.tags,
              projectTagId: resolvedProjectTagId,
              changelog: "Imported from bundle",
            });
            created += 1;
            continue;
          }

          if (conflictStrategy === "skip") {
            skipped += 1;
            continue;
          }

          await this.updatePrompt(existingId, {
            title: prompt.title,
            description: prompt.description,
            category: prompt.category,
            tags: prompt.tags,
            projectTagId: resolvedProjectTagId,
          });

          this.addVersion(
            existingId,
            prompt.body,
            prompt.semanticVersion,
            prompt.format,
            "Imported from bundle",
          );
          updated += 1;
        }

        return { created, updated, skipped };
      },
    );
  }

  public async importPromptBundleFromFile(
    filePath: string,
    options: {
      readonly format?: "json" | "yaml";
      readonly conflictStrategy?: "skip" | "addVersion";
    } = {},
  ): Promise<{ created: number; updated: number; skipped: number }> {
    return this.telemetry.withSpan(
      "service.importPromptBundleFromFile",
      { filePath },
      async () => {
        const stats = fs.statSync(filePath);
        if (stats.size > this.limits.maxFileSizeBytes) {
          throw new ValidationError([
            `File size ${stats.size} bytes exceeds maximum allowed size of ${this.limits.maxFileSizeBytes} bytes`,
          ]);
        }

        const content = fs.readFileSync(filePath, "utf-8");
        const ext = path.extname(filePath).toLowerCase();
        const format =
          options.format ??
          (ext === ".yaml" || ext === ".yml" ? "yaml" : "json");

        return this.importPromptBundle({
          format,
          content,
          conflictStrategy: options.conflictStrategy,
        });
      },
    );
  }

  /**
   * Advanced search prompts with detailed match information, excerpts, and highlighting.
   *
   * Performs sophisticated search with configurable match limits, case sensitivity,
   * and detailed result information including text excerpts and match highlighting.
   * Provides more granular control over search behavior and result presentation.
   *
   * @param queryInput - Advanced search parameters with detailed configuration options
   * @returns Advanced search results with match details, excerpts, and highlighting
   * @throws ValidationError if query parameters are invalid
   *
   * @example
   * ```typescript
   * const results = service.advancedSearchPrompts({
   *   text: "machine learning",
   *   caseSensitive: false,
   *   maxResults: 50,
   *   maxMatchesPerRule: 5,
   *   maxTotalMatches: 100
   * });
   * // Results include highlighted excerpts and match positions
   * ```
   */
  public async advancedSearchPrompts(
    queryInput: z.input<typeof searchQuerySchema>,
  ): Promise<AdvancedPromptSearchResult> {
    return this.telemetry.withSpan(
      "service.advancedSearchPrompts",
      {
        hasText: Boolean(queryInput.text),
        hasFormats: Boolean(queryInput.formats),
        caseSensitive: queryInput.caseSensitive,
        maxResults: queryInput.maxResults,
        maxMatchesPerRule: queryInput.maxMatchesPerRule,
        maxTotalMatches: queryInput.maxTotalMatches,
        hasProjectTag: Boolean(queryInput.projectTagId),
      },
      async () => {
        const query = searchQuerySchema.parse(queryInput);
        const tagIds = query.tags
          ? await this.lookupTagIds(query.tags, { createIfMissing: false })
          : undefined;
        const filterSets: Array<Set<string>> = [];

        if (tagIds && tagIds.length > 0) {
          const ids = await listSharedEntitiesByTags({
            entityType: "prompts",
            tagIds,
            match: "all",
          });
          filterSets.push(new Set(ids));
        }

        if (query.projectTagId) {
          const projectMatches = await listSharedEntitiesByTags({
            entityType: "prompts",
            tagIds: [query.projectTagId],
            match: "all",
          });
          filterSets.push(new Set(projectMatches));
        }

        const allowedIds = filterSets.reduce<Set<string> | null>(
          (acc, current) => {
            if (!acc) return current;
            return new Set([...acc].filter((id) => current.has(id)));
          },
          null,
        );

        if (allowedIds && allowedIds.size === 0) {
          return {
            matches: [],
            page: query.page,
            pageSize: query.pageSize,
            total: 0,
            totalMatches: 0,
          };
        }

        this.logger.debug("advanced_prompt_search", {
          hasText: Boolean(query.text),
          tags: tagIds?.length ?? 0,
          formats: query.formats?.length ?? 0,
          caseSensitive: query.caseSensitive,
          maxResults: query.maxResults,
          maxMatchesPerRule: query.maxMatchesPerRule,
          maxTotalMatches: query.maxTotalMatches,
          category: query.category,
          projectTagId: query.projectTagId,
        });

        const base = this.repository.advancedSearchPrompts({
          text: query.text,
          formats: query.formats,
          page: query.page,
          pageSize: query.pageSize,
          caseSensitive: query.caseSensitive,
          maxResults: query.maxResults,
          maxMatchesPerRule: query.maxMatchesPerRule,
          maxTotalMatches: query.maxTotalMatches,
          category: query.category,
        });

        const matchesWithTags = await Promise.all(
          base.matches.map(async (match) => ({
            ...match,
            prompt: await this.enrichPromptWithTags(match.prompt),
          })),
        );

        const filteredMatches = allowedIds
          ? matchesWithTags.filter((match) => allowedIds.has(match.prompt.id))
          : matchesWithTags;

        return {
          ...base,
          matches: filteredMatches,
          total: allowedIds ? filteredMatches.length : base.total,
        };
      },
    );
  }

  /**
   * Attach tags to an existing prompt.
   *
   * Adds new tags to a prompt while automatically handling deduplication and
   * normalization. Existing tags are preserved, and only new unique tags are added.
   * Tag labels are normalized (trimmed, lowercased) and duplicates are ignored.
   *
   * @param promptId - Unique identifier of the prompt to tag
   * @param labels - Array of tag labels to add (case-insensitive, whitespace-trimmed)
   * @throws PromptNotFoundError if the prompt doesn't exist
   *
   * @example
   * ```typescript
   * service.tagPrompt("550e8400-e29b-41d4-a716-446655440000", [
   *   "machine-learning",
   *   "AI",
   *   "tutorial"
   * ]);
   * // Adds tags while preserving existing ones and avoiding duplicates
   * ```
   */
  public async tagPrompt(
    promptId: PromptId,
    labels: readonly string[],
  ): Promise<void> {
    if (labels.length === 0) {
      return;
    }

    return this.telemetry.withSpan(
      "service.tagPrompt",
      { promptId, count: labels.length },
      async () => {
        this.repository.getPromptById(promptId);
        const tags = await this.ensureSharedTags(labels);
        const current = await listSharedTagsForEntity({
          entityType: "prompts",
          entityId: promptId,
        });
        const currentIds = new Set(current.map((tag) => tag.id));
        const missing = tags.filter((tag) => !currentIds.has(tag.id));
        const domainTags = missing.map((tag) => this.toDomainTag(tag));

        for (const tag of missing) {
          await tagSharedPrompt(promptId, tag.id);
        }

        if (missing.length > 0) {
          this.repository.touchPrompt(promptId, new Date());
          this.logger.info("prompt_tagged", {
            promptId,
            count: missing.length,
          });
          this.pluginHost.emit("onPromptTagged", {
            promptId,
            tags: domainTags,
          });
          emitPromptEvent("pv:prompt_updated", { promptId });
        }
      },
    );
  }

  /**
   * Remove tags from an existing prompt.
   *
   * Removes specified tags from a prompt by label matching. Tag removal is
   * case-insensitive and handles partial matches. Only existing tags are affected.
   *
   * @param promptId - Unique identifier of the prompt to modify
   * @param labels - Array of tag labels to remove (case-insensitive matching)
   * @throws PromptNotFoundError if the prompt doesn't exist
   *
   * @example
   * ```typescript
   * service.untagPrompt("550e8400-e29b-41d4-a716-446655440000", [
   *   "deprecated",
   *   "old-version"
   * ]);
   * // Removes matching tags while preserving others
   * ```
   */
  public async untagPrompt(
    promptId: PromptId,
    labels: readonly string[],
  ): Promise<void> {
    const normalized = this.normalizeLabels(labels).map((label) =>
      label.toLowerCase(),
    );
    if (normalized.length === 0) {
      return;
    }

    return this.telemetry.withSpan(
      "service.untagPrompt",
      { promptId, count: normalized.length },
      async () => {
        this.repository.getPromptById(promptId);
        const current = await listSharedTagsForEntity({
          entityType: "prompts",
          entityId: promptId,
        });
        const removalIds = current
          .filter((tag) =>
            normalized.includes(
              (tag.name ?? tag.description ?? tag.id).toLowerCase(),
            ),
          )
          .map((tag) => tag.id);

        for (const tagId of removalIds) {
          await untagSharedPrompt(promptId, tagId);
        }

        this.repository.touchPrompt(promptId, new Date());

        this.logger.info("prompt_untagged", {
          promptId,
          count: removalIds.length,
        });
        this.pluginHost.emit("onPromptUntagged", {
          promptId,
          labels: normalized,
        });
        emitPromptEvent("pv:prompt_updated", { promptId });
      },
    );
  }

  /**
   * Soft delete a prompt by setting the deleted_at timestamp.
   * @param promptId - Identifier of the prompt to delete.
   * @param deletedAt - Timestamp when the prompt was deleted.
   */
  public softDeletePrompt(
    promptId: PromptId,
    deletedAt: Date = new Date(),
    context: PromptVaultOperationContext = {},
  ): void {
    return this.telemetry.withSpan(
      "service.softDeletePrompt",
      { promptId },
      () => {
        // Ensure the prompt exists and is not already deleted
        const prompt = this.repository.getPromptById(promptId);
        if (prompt.deletedAt) {
          throw new ValidationError(["Prompt is already deleted"]);
        }

        this.repository.softDeletePrompt(promptId, deletedAt);
        this.logger.info("prompt_soft_deleted", { promptId });
        this.pluginHost.emit("onPromptDeleted", {
          promptId,
          mode: "soft",
          actor: context.actor,
        });
        emitPromptEvent("pv:prompt_deleted", {
          promptId,
          actorUserId: context.actor?.userId,
          requestId: context.actor?.requestId,
        });
      },
    );
  }

  /**
   * Restore a soft deleted prompt by clearing the deleted_at timestamp.
   * @param promptId - Identifier of the prompt to restore.
   */
  public restorePrompt(promptId: PromptId): void {
    return this.telemetry.withSpan(
      "service.restorePrompt",
      { promptId },
      () => {
        // The repository restore query deliberately targets deleted rows;
        // normal prompt lookup excludes them from the active library.
        this.repository.restorePrompt(promptId);
        this.logger.info("prompt_restored", { promptId });
        // Note: Plugin events for restore not implemented yet
      },
    );
  }

  /**
   * Get all soft deleted prompts.
   * @returns Array of deleted prompts with their metadata.
   */
  public async getDeletedPrompts(): Promise<readonly Prompt[]> {
    return this.telemetry.withSpan(
      "service.getDeletedPrompts",
      {},
      async () => {
        const deleted = this.repository.getDeletedPrompts();
        return Promise.all(
          deleted.map((prompt) => this.enrichPromptWithTags(prompt)),
        );
      },
    );
  }

  /**
   * Permanently delete a prompt and all its associated data.
   * @param promptId - Identifier of the prompt to permanently delete.
   */
  public permanentlyDeletePrompt(
    promptId: PromptId,
    context: PromptVaultOperationContext = {},
  ): void {
    return this.telemetry.withSpan(
      "service.permanentlyDeletePrompt",
      { promptId },
      () => {
        // Repository deletion accepts active or trashed rows and verifies that
        // a record was actually removed.
        this.repository.permanentlyDeletePrompt(promptId);
        this.logger.info("prompt_permanently_deleted", { promptId });
        this.pluginHost.emit("onPromptDeleted", {
          promptId,
          mode: "permanent",
          actor: context.actor,
        });
        emitPromptEvent("pv:prompt_deleted", {
          promptId,
          actorUserId: context.actor?.userId,
          requestId: context.actor?.requestId,
        });
      },
    );
  }

  /**
   * Import a prompt from an external file.
   *
   * Reads content from a file on disk and creates a new prompt with that content.
   * Automatically detects the format based on file extension, validates file size
   * and content length, and generates appropriate metadata. Supports importing
   * from markdown, JSON, and YAML files.
   *
   * @param filePath - Absolute path to the file to import
   * @param options - Import configuration options
   * @param options.name - Custom name for the prompt (defaults to filename)
   * @param options.tags - Tags to assign to the imported prompt
   * @param options.format - Override auto-detected format
   * @returns The newly created prompt entity
   * @throws ValidationError if file size or content length exceeds limits
   * @throws ValidationError if file cannot be read or content is invalid
   *
   * @example
   * ```typescript
   * const prompt = service.importPromptFromFile("/path/to/prompt.md", {
   *   name: "Custom Greeting",
   *   tags: ["greeting", "imported"],
   *   format: "markdown"
   * });
   * ```
   */
  public async importPromptFromFile(
    filePath: string,
    options: {
      name?: string;
      tags?: readonly string[];
      format?: PromptFormat;
      category?: string;
    } = {},
  ): Promise<Prompt> {
    return this.telemetry.withSpan(
      "service.importPromptFromFile",
      { filePath },
      async () => {
        // Check file size before reading
        const stats = fs.statSync(filePath);
        if (stats.size > this.limits.maxFileSizeBytes) {
          throw new ValidationError([
            `File size ${stats.size} bytes exceeds maximum allowed size of ${this.limits.maxFileSizeBytes} bytes`,
          ]);
        }

        // Read file content
        const content = fs.readFileSync(filePath, "utf-8");

        // Check content length
        if (content.length > this.limits.maxPromptContentLength) {
          throw new ValidationError([
            `Prompt content length ${content.length} characters exceeds maximum allowed length of ${this.limits.maxPromptContentLength} characters`,
          ]);
        }

        // Detect format from file extension if not provided
        const format = options.format || this.detectFormatFromPath(filePath);

        // Generate slug from name or filename
        const baseName =
          options.name || path.basename(filePath, path.extname(filePath));
        const slug = this.generateSlug(baseName);

        // Create the prompt
        const promptInput = {
          id: randomUUID(),
          slug,
          title: baseName,
          description: `Imported from ${filePath}`,
          category: options.category,
          body: content,
          format,
          semanticVersion: "1.0.0",
          tags: [...(options.tags || [])],
          changelog: "Initial import",
        };

        const prompt = await this.createPrompt(promptInput);
        this.logger.info("prompt_imported", { promptId: prompt.id, filePath });
        return prompt;
      },
    );
  }

  /**
   * Export a prompt to a file.
   *
   * Saves a prompt's content to a file on disk with optional format conversion
   * and metadata inclusion. Creates parent directories as needed. Supports
   * exporting to different formats and including comprehensive metadata.
   *
   * @param promptId - Unique identifier of the prompt to export
   * @param filePath - Absolute path where to save the exported file
   * @param options - Export configuration options
   * @param options.format - Target format for export (converts if different from source)
   * @param options.includeMetadata - Whether to include prompt metadata in the file
   * @throws PromptNotFoundError if the prompt doesn't exist
   * @throws ValidationError if the prompt has no content to export
   *
   * @example
   * ```typescript
   * service.exportPromptToFile("550e8400-e29b-41d4-a716-446655440000", "/exports/prompt.md", {
   *   format: "markdown",
   *   includeMetadata: true
   * });
   * // Exports with frontmatter metadata
   * ```
   */
  public async exportPromptToFile(
    promptId: PromptId,
    filePath: string,
    options: {
      format?: PromptFormat;
      includeMetadata?: boolean;
    } = {},
  ): Promise<void> {
    return this.telemetry.withSpan(
      "service.exportPromptToFile",
      { promptId, filePath },
      async () => {
        const prompt = await this.getPrompt(promptId);
        if (!prompt.latestVersion) {
          throw new ValidationError(["Prompt has no content to export"]);
        }

        let content = prompt.latestVersion.body;

        // Convert format if requested
        if (options.format && options.format !== prompt.latestVersion.format) {
          content = convertPromptContent(
            content,
            prompt.latestVersion.format,
            options.format,
          );
        }

        // Add metadata if requested
        if (options.includeMetadata) {
          const metadata = {
            id: prompt.id,
            slug: prompt.slug,
            title: prompt.title,
            description: prompt.description,
            category: prompt.category,
            tags: prompt.tags.map((tag) => tag.label),
            format: options.format || prompt.latestVersion.format,
            version: prompt.latestVersion.semanticVersion,
            exportedAt: new Date().toISOString(),
          };

          if (options.format === "json") {
            content = JSON.stringify({ metadata, content }, null, 2);
          } else if (options.format === "yaml") {
            content = yaml.stringify({ metadata }) + "---\n" + content;
          } else {
            // Markdown format
            content = "---\n" + yaml.stringify(metadata) + "---\n\n" + content;
          }
        }

        // Write to file
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, content, "utf-8");

        this.logger.info("prompt_exported", { promptId, filePath });
      },
    );
  }

  private detectFormatFromPath(filePath: string): PromptFormat {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case ".yaml":
      case ".yml":
        return "yaml";
      case ".json":
        return "json";
      case ".md":
      default:
        return "markdown";
    }
  }

  private generateSlug(baseName: string): string {
    return baseName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .substring(0, 50);
  }

  private normalizeLabels(labels: readonly string[]): string[] {
    return labels
      .map((label) => label.trim())
      .filter((label) => label.length > 0);
  }

  private async ensureCoreDb(): Promise<void> {
    if (!this.coreDbReady) {
      this.coreDbReady = resetCoreDb().catch((error) => {
        this.logger.warn("core_db_reset_failed", {
          error: error instanceof Error ? error.message : error,
        });
      });
    }

    await this.coreDbReady;
  }

  private async ensureSharedTags(
    labels: readonly string[],
  ): Promise<SharedTag[]> {
    await this.ensureCoreDb();
    const normalized = this.normalizeLabels(labels);
    if (normalized.length === 0) {
      return [];
    }

    const unique = new Map<string, string>();
    for (const label of normalized) {
      const key = label.toLowerCase();
      if (!unique.has(key)) {
        unique.set(key, label);
      }
    }

    const existing = await listSharedTags();
    const byName = new Map(
      existing.map((tag) => [tag.name.toLowerCase(), tag] as const),
    );
    const result: SharedTag[] = [];

    for (const [key, label] of unique.entries()) {
      const current = byName.get(key);
      if (current) {
        result.push(current);
        continue;
      }

      const created = await createSharedTag({ name: label, kind: "label" });
      byName.set(key, created);
      result.push(created);
    }

    return result;
  }

  private async lookupTagIds(
    labels: readonly string[],
    options: { createIfMissing: boolean },
  ): Promise<string[]> {
    if (labels.length === 0) {
      return [];
    }

    if (options.createIfMissing) {
      const tags = await this.ensureSharedTags(labels);
      return tags.map((tag) => tag.id);
    }

    const existing = await listSharedTags();
    const normalized = this.normalizeLabels(labels).map((label) =>
      label.toLowerCase(),
    );
    return existing
      .filter((tag) => normalized.includes(tag.name.toLowerCase()))
      .map((tag) => tag.id);
  }

  private async applyTagsToPrompt(
    promptId: string,
    tagIds: readonly string[],
  ): Promise<void> {
    for (const tagId of tagIds) {
      await tagSharedPrompt(promptId, tagId);
    }
  }

  private async assertProjectTagExists(projectTagId: string): Promise<void> {
    await this.ensureCoreDb();
    const tag = await getTagById(projectTagId);
    if (!tag) {
      throw new ValidationError([`Project tag not found: ${projectTagId}`]);
    }
    if (tag.kind !== "project") {
      throw new ValidationError([`Tag ${projectTagId} is not a project tag`]);
    }
  }

  private toDomainTag(tag: SharedTag): Tag {
    return {
      id: tag.id,
      label: tag.name,
      description: tag.description ?? undefined,
      createdAt: tag.createdAt ? new Date(tag.createdAt) : new Date(),
    };
  }

  private async enrichPromptWithTags(prompt: Prompt): Promise<Prompt> {
    await this.ensureCoreDb();
    const sharedTags = await listSharedTagsForEntity({
      entityType: "prompts",
      entityId: prompt.id,
    });
    return {
      ...prompt,
      tags: sharedTags.map((tag) => this.toDomainTag(tag)),
    };
  }

  /**
   * Run comprehensive diagnostics on the prompt library.
   *
   * Performs a thorough health check of the prompt database, identifying data
   * integrity issues, orphaned records, invalid content, and other potential
   * problems. Provides detailed statistics and actionable issue reports.
   *
   * @returns Comprehensive diagnostic report containing:
   *   - Summary statistics (prompts, versions, tags, issues counts)
   *   - Detailed list of identified issues with severity levels
   *   - Specific prompt IDs and error details for problematic records
   *
   * @example
   * ```typescript
   * const diagnostics = service.runDiagnostics();
   * console.log(`Found ${diagnostics.issues.length} issues`);
   * console.log(`Total prompts: ${diagnostics.summary.totalPrompts}`);
   *
   * for (const issue of diagnostics.issues) {
   *   if (issue.type === 'error') {
   *     console.error(`Error: ${issue.message}`);
   *   }
   * }
   * ```
   */
  public async runDiagnostics(): Promise<{
    summary: {
      totalPrompts: number;
      totalVersions: number;
      totalTags: number;
      deletedPrompts: number;
      orphanedTags: number;
      invalidContent: number;
    };
    migration: {
      currentVersion: number;
      latestVersion: number;
      pendingVersions: readonly number[];
    };
    integrity: {
      status: "ok" | "error";
      details?: unknown;
    };
    issues: Array<{
      type: "error" | "warning";
      message: string;
      promptId?: string;
      details?: unknown;
    }>;
  }> {
    return this.telemetry.withSpan("service.runDiagnostics", {}, async () => {
      const issues: Array<{
        type: "error" | "warning";
        message: string;
        promptId?: string;
        details?: unknown;
      }> = [];

      let migrationState: {
        currentVersion: number;
        latestVersion: number;
        pendingVersions: readonly number[];
      };
      try {
        const state = this.repository.getMigrationState();
        migrationState = {
          currentVersion: state.currentVersion,
          latestVersion: state.latestVersion,
          pendingVersions: state.pendingVersions,
        };
      } catch (error) {
        migrationState = {
          currentVersion: 0,
          latestVersion: 0,
          pendingVersions: [],
        };
        issues.push({
          type: "error",
          message: "Failed to read migration state",
          details: error instanceof Error ? error.message : error,
        });
      }
      const integrity: { status: "ok" | "error"; details?: unknown } = {
        status: "ok",
      };

      // Get basic statistics
      const allPrompts = await Promise.all(
        this.repository
          .getAllPrompts()
          .map((prompt) => this.enrichPromptWithTags(prompt)),
      );
      const deletedPrompts = await Promise.all(
        this.repository
          .getDeletedPrompts()
          .map((prompt) => this.enrichPromptWithTags(prompt)),
      );
      const allTags = await listSharedTags();

      const linkedTagIds = new Set(
        allPrompts.flatMap((p) => p.tags.map((tag) => tag.id)),
      );

      let totalVersions = 0;
      let invalidContent = 0;
      let orphanedTags = 0;

      // Check each prompt for issues
      for (const prompt of allPrompts) {
        // Check for prompts without versions
        if (!prompt.latestVersion) {
          issues.push({
            type: "error",
            message: "Prompt has no versions",
            promptId: prompt.id,
          });
        } else {
          totalVersions++;

          // Validate content format
          try {
            validatePromptContent(
              prompt.latestVersion.body,
              prompt.latestVersion.format,
            );
          } catch (error) {
            invalidContent++;
            issues.push({
              type: "error",
              message: `Invalid ${prompt.latestVersion.format} content`,
              promptId: prompt.id,
              details: error instanceof Error ? error.message : error,
            });
          }
        }
      }

      orphanedTags = allTags.filter((tag) => !linkedTagIds.has(tag.id)).length;

      const requiredTables = [
        "prompts",
        "prompt_versions",
        "tags",
        "prompt_tags",
      ];
      const missingTables = requiredTables.filter(
        (table) => !this.repository.hasTable(table),
      );

      if (missingTables.length > 0) {
        issues.push({
          type: "error",
          message: `Missing required tables: ${missingTables.join(", ")}`,
          details: { missingTables },
        });
      }

      // Check database integrity
      try {
        const result = this.repository
          .getDatabase()
          .prepare("PRAGMA integrity_check")
          .get() as { integrity_check?: string } | undefined;
        if (!result || typeof result.integrity_check !== "string") {
          integrity.status = "error";
          issues.push({
            type: "error",
            message: "Database integrity check returned no result",
            details: result,
          });
        } else if (result.integrity_check.toLowerCase() !== "ok") {
          integrity.status = "error";
          integrity.details = result.integrity_check;
          issues.push({
            type: "error",
            message: "Database integrity check failed",
            details: result.integrity_check,
          });
        }
      } catch (error) {
        integrity.status = "error";
        issues.push({
          type: "error",
          message: "Database integrity check failed",
          details: error instanceof Error ? error.message : error,
        });
      }

      if (migrationState.pendingVersions.length > 0) {
        issues.push({
          type: "error",
          message: "Pending migrations detected",
          details: { pendingVersions: migrationState.pendingVersions },
        });
      }

      return {
        summary: {
          totalPrompts: allPrompts.length,
          totalVersions,
          totalTags: allTags.length,
          deletedPrompts: deletedPrompts.length,
          orphanedTags,
          invalidContent,
        },
        migration: {
          currentVersion: migrationState.currentVersion,
          latestVersion: migrationState.latestVersion,
          pendingVersions: migrationState.pendingVersions,
        },
        integrity,
        issues,
      };
    });
  }

  /**
   * Get library statistics and analytics.
   *
   * Computes comprehensive statistics about the prompt library including counts,
   * distributions, usage patterns, and recent activity. Useful for monitoring
   * library health and user engagement.
   *
   * @returns Detailed statistics covering:
   *   - Prompt counts by status and format
   *   - Tag usage statistics and most popular tags
   *   - Version distribution and averages
   *   - Recent activity metrics (last 7 days)
   *
   * @example
   * ```typescript
   * const stats = service.getLibraryStats();
   * console.log(`Library has ${stats.prompts.total} prompts`);
   * console.log(`Most used tag: ${stats.tags.mostUsed[0]?.label}`);
   * console.log(`Created this week: ${stats.activity.createdThisWeek}`);
   * ```
   */
  public async getLibraryStats(): Promise<{
    prompts: {
      total: number;
      active: number;
      deleted: number;
      byFormat: Record<string, number>;
    };
    tags: {
      total: number;
      averagePerPrompt: number;
      mostUsed: Array<{ label: string; count: number }>;
    };
    versions: {
      total: number;
      averagePerPrompt: number;
    };
    activity: {
      createdThisWeek: number;
      updatedThisWeek: number;
      deletedThisWeek: number;
    };
  }> {
    return this.telemetry.withSpan("service.getLibraryStats", {}, async () => {
      const allPrompts = await Promise.all(
        this.repository
          .getAllPrompts()
          .map((prompt) => this.enrichPromptWithTags(prompt)),
      );
      const deletedPrompts = await Promise.all(
        this.repository
          .getDeletedPrompts()
          .map((prompt) => this.enrichPromptWithTags(prompt)),
      );
      const allTags = await listSharedTags();

      // Calculate format distribution
      const formatCounts: Record<string, number> = {};
      for (const prompt of allPrompts) {
        if (prompt.latestVersion) {
          const format = prompt.latestVersion.format;
          formatCounts[format] = (formatCounts[format] || 0) + 1;
        }
      }

      // Calculate tag usage
      const tagUsage = new Map<string, number>();
      for (const prompt of allPrompts) {
        for (const tag of prompt.tags) {
          tagUsage.set(tag.label, (tagUsage.get(tag.label) || 0) + 1);
        }
      }

      const mostUsedTags = Array.from(tagUsage.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([label, count]) => ({ label, count }));

      // Calculate version statistics
      const totalVersions = allPrompts.reduce((sum: number, prompt: Prompt) => {
        // This is approximate - we'd need to query versions table for exact count
        return sum + (prompt.latestVersion ? 1 : 0);
      }, 0);

      // Calculate recent activity (last 7 days)
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const createdThisWeek = allPrompts.filter(
        (p: Prompt) => p.createdAt >= weekAgo,
      ).length;
      const updatedThisWeek = allPrompts.filter(
        (p: Prompt) => p.updatedAt >= weekAgo,
      ).length;
      const deletedThisWeek = deletedPrompts.filter(
        (p: Prompt) => p.deletedAt && p.deletedAt >= weekAgo,
      ).length;

      return {
        prompts: {
          total: allPrompts.length,
          active: allPrompts.length - deletedPrompts.length,
          deleted: deletedPrompts.length,
          byFormat: formatCounts,
        },
        tags: {
          total: allTags.length,
          averagePerPrompt:
            allPrompts.length > 0 ? allTags.length / allPrompts.length : 0,
          mostUsed: mostUsedTags,
        },
        versions: {
          total: totalVersions,
          averagePerPrompt:
            allPrompts.length > 0 ? totalVersions / allPrompts.length : 0,
        },
        activity: {
          createdThisWeek,
          updatedThisWeek,
          deletedThisWeek,
        },
      };
    });
  }

  /**
   * Repair common data integrity issues.
   *
   * Attempts to automatically fix detected data integrity problems such as
   * invalid content formats and orphaned records. Uses diagnostics to identify
   * issues and applies targeted repairs where possible.
   *
   * @returns Repair operation results containing:
   *   - List of successful repairs with counts
   *   - Any errors encountered during repair attempts
   *
   * @example
   * ```typescript
   * const result = service.repairIntegrity();
   * console.log(`Performed ${result.repairs.length} repairs`);
   *
   * for (const repair of result.repairs) {
   *   console.log(`Fixed ${repair.count} ${repair.type} issues`);
   * }
   * ```
   */
  public async repairIntegrity(): Promise<{
    repairs: Array<{
      type: string;
      description: string;
      count: number;
    }>;
    errors: Array<{
      message: string;
      details?: unknown;
    }>;
  }> {
    return this.telemetry.withSpan("service.repairIntegrity", {}, async () => {
      const repairs: Array<{
        type: string;
        description: string;
        count: number;
      }> = [];

      const errors: Array<{
        message: string;
        details?: unknown;
      }> = [];

      try {
        // Run diagnostics to identify issues
        const diagnostics = await this.runDiagnostics();

        // Attempt to repair invalid content by re-validating
        if (diagnostics.summary.invalidContent > 0) {
          let repaired = 0;
          for (const issue of diagnostics.issues) {
            if (
              issue.type === "error" &&
              issue.message.includes("Invalid") &&
              issue.promptId
            ) {
              try {
                const prompt = this.repository.getPromptById(issue.promptId);
                if (prompt.latestVersion) {
                  // Try to detect and fix format
                  const detectedFormat = detectPromptFormat(
                    prompt.latestVersion.body,
                  );
                  if (detectedFormat !== prompt.latestVersion.format) {
                    // Update the format in the database
                    this.repository.updateVersionFormat(
                      prompt.latestVersion.id,
                      detectedFormat,
                    );
                    repaired++;
                  }
                }
              } catch (repairError) {
                errors.push({
                  message: `Failed to repair prompt ${issue.promptId}`,
                  details:
                    repairError instanceof Error
                      ? repairError.message
                      : repairError,
                });
              }
            }
          }

          if (repaired > 0) {
            repairs.push({
              type: "content_format",
              description: "Fixed invalid content formats by auto-detection",
              count: repaired,
            });
          }
        }

        // Clean up orphaned tags (tags not linked to any prompts)
        if (diagnostics.summary.orphanedTags > 0) {
          // This would require more complex logic to identify truly orphaned tags
          // For now, we'll just report them
          repairs.push({
            type: "orphaned_tags",
            description: "Orphaned tags detected (manual cleanup required)",
            count: diagnostics.summary.orphanedTags,
          });
        }
      } catch (error) {
        errors.push({
          message: "Integrity repair failed",
          details: error instanceof Error ? error.message : error,
        });
      }

      return { repairs, errors };
    });
  }

  /**
   * Get the plugin host for accessing registered plugins and connectors.
   *
   * Provides access to the plugin ecosystem for registering new plugins,
   * emitting events, or querying registered extensions. This enables
   * integration with external tools and custom functionality.
   *
   * @returns The plugin host instance for plugin management
   *
   * @example
   * ```typescript
   * const pluginHost = service.getPluginHost();
   * pluginHost.register(myCustomPlugin);
   * ```
   */
  public getPluginHost(): PluginHost {
    return this.pluginHost;
  }

  /**
   * Import multiple prompts from files in bulk.
   *
   * Processes multiple prompt files in a single operation, importing each one
   * as a separate prompt. Provides progress tracking and error handling for
   * batch operations. Skips files that fail to import and continues with others.
   *
   * @param filePaths - Array of absolute file paths to import
   * @param options - Import configuration options applied to all files
   * @param options.tags - Tags to apply to all imported prompts
   * @param options.category - Category to assign to all imported prompts
   * @param options.format - Format override for all files (auto-detected if not provided)
   * @param options.skipErrors - Whether to continue importing other files if one fails
   * @returns Bulk import results with success/failure counts and details
   *
   * @example
   * ```typescript
   * const result = service.bulkImportPrompts([
   *   "/prompts/greeting.md",
   *   "/prompts/farewell.md"
   * ], {
   *   tags: ["social"],
   *   category: "communication"
   * });
   *
   * console.log(`Imported ${result.successful.length} prompts`);
   * console.log(`Failed ${result.failed.length} imports`);
   * ```
   */
  public async bulkImportPrompts(
    filePaths: readonly string[],
    options: {
      tags?: readonly string[];
      category?: string;
      format?: PromptFormat;
      skipErrors?: boolean;
    } = {},
  ): Promise<{
    successful: Array<{ filePath: string; prompt: Prompt }>;
    failed: Array<{ filePath: string; error: string }>;
  }> {
    return this.telemetry.withSpan(
      "service.bulkImportPrompts",
      { fileCount: filePaths.length },
      async () => {
        const successful: Array<{ filePath: string; prompt: Prompt }> = [];
        const failed: Array<{ filePath: string; error: string }> = [];

        for (const filePath of filePaths) {
          try {
            const prompt = await this.importPromptFromFile(filePath, {
              tags: options.tags,
              category: options.category,
              format: options.format,
            });
            successful.push({ filePath, prompt });
            this.logger.info("bulk_import_success", {
              filePath,
              promptId: prompt.id,
            });
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            failed.push({ filePath, error: errorMessage });
            this.logger.warn("bulk_import_failed", {
              filePath,
              error: errorMessage,
            });

            if (!options.skipErrors) {
              break;
            }
          }
        }

        this.logger.info("bulk_import_completed", {
          total: filePaths.length,
          successful: successful.length,
          failed: failed.length,
        });

        return { successful, failed };
      },
    );
  }

  /**
   * Export multiple prompts to files in bulk.
   *
   * Exports multiple prompts to separate files in a single operation.
   * Creates output directory structure as needed and provides progress
   * tracking with error handling for batch operations.
   *
   * @param promptIds - Array of prompt IDs to export
   * @param outputDir - Base directory where files will be created
   * @param options - Export configuration options
   * @param options.format - Target format for all exports
   * @param options.includeMetadata - Whether to include metadata in exported files
   * @param options.namingPattern - Filename pattern ("{slug}", "{title}", "{id}")
   * @param options.skipErrors - Whether to continue exporting other prompts if one fails
   * @returns Bulk export results with success/failure counts and file paths
   *
   * @example
   * ```typescript
   * const result = service.bulkExportPrompts(
   *   ["550e8400-e29b-41d4-a716-446655440000", "550e8400-e29b-41d4-a716-446655440001"],
   *   "/exports",
   *   {
   *     format: "markdown",
   *     namingPattern: "{slug}",
   *     includeMetadata: true
   *   }
   * );
   *
   * console.log(`Exported ${result.successful.length} prompts to ${result.outputDir}`);
   * ```
   */
  public async bulkExportPrompts(
    promptIds: readonly string[],
    outputDir: string,
    options: {
      format?: PromptFormat;
      includeMetadata?: boolean;
      namingPattern?: string;
      skipErrors?: boolean;
    } = {},
  ): Promise<{
    successful: Array<{ promptId: string; filePath: string }>;
    failed: Array<{ promptId: string; error: string }>;
    outputDir: string;
  }> {
    return this.telemetry.withSpan(
      "service.bulkExportPrompts",
      { promptCount: promptIds.length, outputDir },
      async () => {
        const successful: Array<{ promptId: string; filePath: string }> = [];
        const failed: Array<{ promptId: string; error: string }> = [];
        const namingPattern = options.namingPattern || "{slug}";

        // Ensure output directory exists
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        for (const promptId of promptIds) {
          try {
            const prompt = await this.getPrompt(promptId);

            // Generate filename based on pattern
            let filename = namingPattern;
            filename = filename.replace("{slug}", prompt.slug);
            filename = filename.replace(
              "{title}",
              prompt.title.replace(/[^a-zA-Z0-9]/g, "_"),
            );
            filename = filename.replace("{id}", promptId);

            // Add appropriate extension
            const targetFormat =
              options.format || prompt.latestVersion?.format || "markdown";
            const extension =
              targetFormat === "markdown"
                ? "md"
                : targetFormat === "yaml"
                  ? "yaml"
                  : "json";
            const filePath = path.join(outputDir, `${filename}.${extension}`);

            await this.exportPromptToFile(promptId, filePath, {
              format: options.format,
              includeMetadata: options.includeMetadata,
            });

            successful.push({ promptId, filePath });
            this.logger.info("bulk_export_success", { promptId, filePath });
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            failed.push({ promptId, error: errorMessage });
            this.logger.warn("bulk_export_failed", {
              promptId,
              error: errorMessage,
            });

            if (!options.skipErrors) {
              break;
            }
          }
        }

        this.logger.info("bulk_export_completed", {
          total: promptIds.length,
          successful: successful.length,
          failed: failed.length,
          outputDir,
        });

        return { successful, failed, outputDir };
      },
    );
  }
}
