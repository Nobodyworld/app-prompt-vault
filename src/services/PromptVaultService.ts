import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { z, ZodIssue } from "zod";
import type { Prompt, PromptId, PromptSearchResult, PromptVersion, Tag } from "../domain/models.js";
import { ValidationError } from "../domain/errors.js";
import { promptInputSchema, searchQuerySchema } from "../domain/validation.js";
import { PromptRepository } from "../repositories/PromptRepository.js";
import type { Telemetry } from "../observability/telemetry.js";
import { createNoopTelemetry } from "../observability/telemetry.js";
import type { StructuredLogger } from "../observability/logger.js";
import { createLoggerFromEnv } from "../observability/logger.js";
import { PluginHost } from "../extensions/PluginHost.js";
import type { PromptVaultPlugin } from "../extensions/types.js";

export interface PromptVaultServiceOptions {
  readonly telemetry?: Telemetry;
  readonly logger?: StructuredLogger;
  readonly plugins?: readonly PromptVaultPlugin[];
}

/**
 * High-level façade orchestrating prompt workflows and validation.
 */
export class PromptVaultService {
  private readonly repository: PromptRepository;

  private readonly telemetry: Telemetry;

  private readonly logger: StructuredLogger;

  private readonly pluginHost: PluginHost;

  public constructor(database: Database.Database, options: PromptVaultServiceOptions = {}) {
    this.telemetry = options.telemetry ?? createNoopTelemetry();
    this.logger = options.logger ?? createLoggerFromEnv({ serviceName: "prompt-vault-service" });
    this.repository = new PromptRepository(database, { telemetry: this.telemetry, logger: this.logger });
    this.pluginHost = new PluginHost({
      logger: this.logger.child({ component: "plugin-host" }),
      telemetry: this.telemetry,
    });

    for (const plugin of options.plugins ?? []) {
      this.pluginHost.register(plugin);
    }
  }

  /**
   * Create a prompt with an initial version and optional tags.
   * @param input - User-supplied prompt payload.
   */
  public createPrompt(input: z.input<typeof promptInputSchema>): Prompt {
    return this.telemetry.withSpan("service.createPrompt", { slug: input.slug }, () => {
      const result = promptInputSchema.safeParse(input);
      if (!result.success) {
        throw new ValidationError(result.error.issues.map((error: ZodIssue) => error.message));
      }

      const { id, slug, title, description, body, semanticVersion, tags, changelog } = result.data;
      const normalizedTags = this.prepareTags(tags);
      const timestamp = new Date();
      const prompt: Prompt = {
        id,
        slug,
        title,
        description,
        tags: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const version: PromptVersion = {
        id: randomUUID(),
        promptId: id,
        semanticVersion,
        body,
        changelog,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      this.repository.createPrompt(prompt, version, normalizedTags);
      const persisted = this.repository.getPromptById(id);
      this.logger.info("prompt_created", { promptId: persisted.id, slug });
      this.pluginHost.emit("onPromptCreated", { prompt: persisted, version });
      return persisted;
    });
  }

  /**
   * Retrieve a prompt by identifier.
   * @param promptId - Identifier to search for.
   */
  public getPrompt(promptId: PromptId): Prompt {
    return this.repository.getPromptById(promptId);
  }

  /**
   * Append a new version to an existing prompt.
   * @param promptId - Identifier of the prompt to update.
   * @param body - New prompt body text.
   * @param semanticVersion - Semantic version label.
   * @param changelog - Optional changelog entry.
   */
  public addVersion(
    promptId: PromptId,
    body: string,
    semanticVersion: string,
    changelog?: string
  ): PromptVersion {
    // Ensure the prompt exists; repository will throw PromptNotFoundError otherwise.
    return this.telemetry.withSpan("service.addVersion", { promptId }, () => {
      this.repository.getPromptById(promptId);

      const timestamp = new Date();
      const version: PromptVersion = {
        id: randomUUID(),
        promptId,
        semanticVersion,
        body,
        changelog,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      this.repository.addVersion(version);
      this.logger.info("prompt_version_added", { promptId, version: semanticVersion });
      this.pluginHost.emit("onVersionAdded", { promptId, version });
      return version;
    });
  }

  /**
   * Search prompts using fuzzy text and tag filters.
   * @param queryInput - Query filters.
   */
  public searchPrompts(queryInput: z.input<typeof searchQuerySchema>): PromptSearchResult {
    return this.telemetry.withSpan("service.searchPrompts", { hasText: Boolean(queryInput.text) }, () => {
      const query = searchQuerySchema.parse(queryInput);
      this.logger.debug("prompt_search", {
        hasText: Boolean(query.text),
        tags: query.tags?.length ?? 0,
      });
      return this.repository.searchPrompts(query);
    });
  }

  /**
   * Attach tags to an existing prompt.
   * @param promptId - Identifier of the prompt to tag.
   * @param labels - Tag labels to add.
   */
  public tagPrompt(promptId: PromptId, labels: readonly string[]): void {
    if (labels.length === 0) {
      return;
    }

    this.telemetry.withSpan("service.tagPrompt", { promptId, count: labels.length }, () => {
      const prompt = this.repository.getPromptById(promptId);
      const existingLabels = new Set(prompt.tags.map((tag) => tag.label.toLowerCase()));

      // TODO(P2, 3d): Add support for removing tags from prompts via service method once tag detach UX is defined.
      const tags = this.prepareTags(labels, existingLabels);
      if (tags.length === 0) {
        return;
      }

      this.repository.upsertTags(promptId, tags, new Date());
      this.logger.info("prompt_tagged", { promptId, count: tags.length });
      this.pluginHost.emit("onPromptTagged", { promptId, tags });
    });
  }

  private prepareTags(labels: readonly string[], existingLabels: ReadonlySet<string> = new Set()): Tag[] {
    const seen = new Set<string>(Array.from(existingLabels, (label) => label.toLowerCase()));

    return labels
      .map((label) => label.trim())
      .filter((label) => label.length > 0)
      .filter((label) => {
        const normalized = label.toLowerCase();
        if (seen.has(normalized)) {
          return false;
        }
        seen.add(normalized);
        return true;
      })
      .map((label) => ({
        id: randomUUID(),
        label,
        description: undefined,
        createdAt: new Date(),
      }));
  }
}
