import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { Prompt, PromptId, PromptSearchResult, PromptVersion, Tag } from "../domain/models.js";
import { ValidationError } from "../domain/errors.js";
import { promptInputSchema, searchQuerySchema } from "../domain/validation.js";
import { PromptRepository } from "../repositories/PromptRepository.js";

/**
 * High-level façade orchestrating prompt workflows and validation.
 */
export class PromptVaultService {
  private readonly repository: PromptRepository;

  public constructor(database: Database.Database) {
    this.repository = new PromptRepository(database);
  }

  /**
   * Create a prompt with an initial version and optional tags.
   * @param input - User-supplied prompt payload.
   */
  public createPrompt(input: z.input<typeof promptInputSchema>): Prompt {
    const result = promptInputSchema.safeParse(input);
    if (!result.success) {
      throw new ValidationError(result.error.errors.map((error) => error.message));
    }

    const { id, slug, title, description, body, semanticVersion, tags, changelog } = result.data;
    const prompt: Prompt = {
      id,
      slug,
      title,
      description,
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const version: PromptVersion = {
      id: randomUUID(),
      promptId: id,
      semanticVersion,
      body,
      changelog,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.repository.createPrompt(prompt, version);

    if (tags.length > 0) {
      this.repository.upsertTags(
        id,
        tags.map((label) => this.createTag(label))
      );
    }

    return this.repository.getPromptById(id);
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
    this.repository.getPromptById(promptId);

    const version: PromptVersion = {
      id: randomUUID(),
      promptId,
      semanticVersion,
      body,
      changelog,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.repository.addVersion(version);
    return version;
  }

  /**
   * Search prompts using fuzzy text and tag filters.
   * @param queryInput - Query filters.
   */
  public searchPrompts(queryInput: z.input<typeof searchQuerySchema>): PromptSearchResult {
    const query = searchQuerySchema.parse(queryInput);
    return this.repository.searchPrompts(query);
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

    const tags = labels.map((label) => this.createTag(label));
    this.repository.upsertTags(promptId, tags);
  }

  private createTag(label: string): Tag {
    return {
      id: randomUUID(),
      label,
      description: undefined,
      createdAt: new Date(),
    };
  }
}
