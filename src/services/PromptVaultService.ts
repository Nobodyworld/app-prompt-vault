import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { z, ZodIssue } from "zod";
import type { Prompt, PromptId, PromptSearchResult, PromptVersion, Tag, PromptFormat, AdvancedPromptSearchResult } from "../domain/models.js";
import { ValidationError } from "../domain/errors.js";
import { promptInputSchema, searchQuerySchema } from "../domain/validation.js";
import { PromptRepository } from "../repositories/PromptRepository.js";
import type { Telemetry } from "../observability/telemetry.js";
import { createNoopTelemetry } from "../observability/telemetry.js";
import type { StructuredLogger } from "../observability/logger.js";
import { createLoggerFromEnv } from "../observability/logger.js";
import { PluginHost } from "../extensions/PluginHost.js";
import type { PromptVaultPlugin } from "../extensions/types.js";
import { convertPromptContent, validatePromptContent, detectPromptFormat } from "../domain/conversion.js";
import { SnapshotManager } from "../domain/snapshot.js";
import fs from "fs";
import path from "path";
import yaml from "yaml";

export interface PromptVaultServiceOptions {
  readonly telemetry?: Telemetry;
  readonly logger?: StructuredLogger;
  readonly plugins?: readonly PromptVaultPlugin[];
  readonly limits?: {
    readonly maxFileSizeBytes: number;
    readonly maxPromptContentLength: number;
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

  public constructor(database: Database.Database, options: PromptVaultServiceOptions = {}) {
    this.telemetry = options.telemetry ?? createNoopTelemetry();
    this.logger = options.logger ?? createLoggerFromEnv({ serviceName: "prompt-vault-service" });
    this.repository = new PromptRepository(database, { telemetry: this.telemetry, logger: this.logger });
    this.pluginHost = new PluginHost({
      logger: this.logger.child({ component: "plugin-host" }),
      telemetry: this.telemetry,
    });

    this.limits = options.limits ?? {
      maxFileSizeBytes: 10 * 1024 * 1024, // 10MB
      maxPromptContentLength: 100 * 1024, // 100KB
    };

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

      const { id, slug, title, description, body, semanticVersion, tags, changelog, format } = result.data;

      // Validate content format
      validatePromptContent(body, format);

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
        format,
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
   * @param format - Format of the prompt content.
   * @param changelog - Optional changelog entry.
   */
  public addVersion(
    promptId: PromptId,
    body: string,
    semanticVersion: string,
    format: PromptFormat = "markdown",
    changelog?: string
  ): PromptVersion {
    // Ensure the prompt exists; repository will throw PromptNotFoundError otherwise.
    return this.telemetry.withSpan("service.addVersion", { promptId }, () => {
      this.repository.getPromptById(promptId);

      // Check content length
      if (body.length > this.limits.maxPromptContentLength) {
        throw new ValidationError([`Prompt content length ${body.length} characters exceeds maximum allowed length of ${this.limits.maxPromptContentLength} characters`]);
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
      this.logger.info("prompt_version_added", { promptId, version: semanticVersion });
      this.pluginHost.emit("onVersionAdded", { promptId, version });
      return version;
    });
  }

  /**
   * Convert a prompt's content to a different format.
   * @param promptId - Identifier of the prompt.
   * @param targetFormat - The desired output format.
   * @returns The converted content.
   */
  public convertPrompt(promptId: PromptId, targetFormat: PromptFormat): string {
    return this.telemetry.withSpan("service.convertPrompt", { promptId, targetFormat }, () => {
      const prompt = this.repository.getPromptById(promptId);
      if (!prompt.latestVersion) {
        throw new ValidationError(["Prompt has no versions to convert"]);
      }

      const converted = convertPromptContent(
        prompt.latestVersion.body,
        prompt.latestVersion.format,
        targetFormat
      );

      this.logger.info("prompt_converted", { promptId, from: prompt.latestVersion.format, to: targetFormat });
      return converted;
    });
  }

  /**
   * Create a compressed snapshot of the database.
   * @param snapshotPath - Path where the compressed snapshot should be saved.
   * @returns Promise that resolves when backup is complete.
   */
  public async createSnapshot(snapshotPath: string): Promise<void> {
    return this.telemetry.withSpan("service.createSnapshot", { snapshotPath }, async () => {
      await SnapshotManager.createSnapshot(this.repository.getDatabase(), snapshotPath);
      this.logger.info("snapshot_created", { snapshotPath });
    });
  }

  /**
   * Restore database from a compressed snapshot.
   * @param snapshotPath - Path to the compressed snapshot file.
   * @returns Promise that resolves when restore is complete.
   */
  public async restoreSnapshot(snapshotPath: string): Promise<void> {
    return this.telemetry.withSpan("service.restoreSnapshot", { snapshotPath }, async () => {
      await SnapshotManager.restoreSnapshot(snapshotPath, this.repository.getDatabase());
      this.logger.info("snapshot_restored", { snapshotPath });
    });
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
   * @param queryInput - Query filters.
   */
  public searchPrompts(queryInput: z.input<typeof searchQuerySchema>): PromptSearchResult {
    return this.telemetry.withSpan("service.searchPrompts", {
      hasText: Boolean(queryInput.text),
      hasFormats: Boolean(queryInput.formats)
    }, () => {
      const query = searchQuerySchema.parse(queryInput);
      this.logger.debug("prompt_search", {
        hasText: Boolean(query.text),
        tags: query.tags?.length ?? 0,
        formats: query.formats?.length ?? 0,
      });
      return this.repository.searchPrompts(query);
    });
  }

  /**
   * Advanced search prompts with detailed match information, excerpts, and highlighting.
   * @param queryInput - Query filters with advanced options.
   */
  public advancedSearchPrompts(queryInput: z.input<typeof searchQuerySchema>): AdvancedPromptSearchResult {
    return this.telemetry.withSpan("service.advancedSearchPrompts", {
      hasText: Boolean(queryInput.text),
      hasFormats: Boolean(queryInput.formats),
      caseSensitive: queryInput.caseSensitive,
      maxResults: queryInput.maxResults,
      maxMatchesPerRule: queryInput.maxMatchesPerRule,
      maxTotalMatches: queryInput.maxTotalMatches,
    }, () => {
      const query = searchQuerySchema.parse(queryInput);
      this.logger.debug("advanced_prompt_search", {
        hasText: Boolean(query.text),
        tags: query.tags?.length ?? 0,
        formats: query.formats?.length ?? 0,
        caseSensitive: query.caseSensitive,
        maxResults: query.maxResults,
        maxMatchesPerRule: query.maxMatchesPerRule,
        maxTotalMatches: query.maxTotalMatches,
      });
      return this.repository.advancedSearchPrompts(query);
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
      const tags = this.prepareTags(labels, existingLabels);
      if (tags.length === 0) {
        return;
      }

      this.repository.upsertTags(promptId, tags, new Date());
      this.logger.info("prompt_tagged", { promptId, count: tags.length });
      this.pluginHost.emit("onPromptTagged", { promptId, tags });
    });
  }

    /**
   * Remove tags from an existing prompt.
   * @param promptId - Identifier of the prompt to modify.
   * @param labels - Tag labels to remove (case-insensitive).
   */
  public untagPrompt(promptId: PromptId, labels: readonly string[]): void {
    const normalized = this.normalizeLabels(labels);
    if (normalized.length === 0) {
      return;
    }

    this.telemetry.withSpan("service.untagPrompt", { promptId, count: normalized.length }, () => {
      this.repository.getPromptById(promptId);
      this.repository.removeTags(promptId, normalized, new Date());
      this.logger.info("prompt_untagged", { promptId, count: normalized.length });
      this.pluginHost.emit("onPromptUntagged", { promptId, labels: normalized });
    });
  }

  /**
   * Soft delete a prompt by setting the deleted_at timestamp.
   * @param promptId - Identifier of the prompt to delete.
   * @param deletedAt - Timestamp when the prompt was deleted.
   */
  public softDeletePrompt(promptId: PromptId, deletedAt: Date = new Date()): void {
    return this.telemetry.withSpan("service.softDeletePrompt", { promptId }, () => {
      // Ensure the prompt exists and is not already deleted
      const prompt = this.repository.getPromptById(promptId);
      if (prompt.deletedAt) {
        throw new ValidationError(["Prompt is already deleted"]);
      }

      this.repository.softDeletePrompt(promptId, deletedAt);
      this.logger.info("prompt_soft_deleted", { promptId });
      // Note: Plugin events for soft delete not implemented yet
    });
  }

  /**
   * Restore a soft deleted prompt by clearing the deleted_at timestamp.
   * @param promptId - Identifier of the prompt to restore.
   */
  public restorePrompt(promptId: PromptId): void {
    return this.telemetry.withSpan("service.restorePrompt", { promptId }, () => {
      // Ensure the prompt exists and is deleted
      const prompt = this.repository.getPromptById(promptId);
      if (!prompt.deletedAt) {
        throw new ValidationError(["Prompt is not deleted"]);
      }

      this.repository.restorePrompt(promptId);
      this.logger.info("prompt_restored", { promptId });
      // Note: Plugin events for restore not implemented yet
    });
  }

  /**
   * Get all soft deleted prompts.
   * @returns Array of deleted prompts with their metadata.
   */
  public getDeletedPrompts(): readonly Prompt[] {
    return this.telemetry.withSpan("service.getDeletedPrompts", {}, () => {
      return this.repository.getDeletedPrompts();
    });
  }

  /**
   * Permanently delete a prompt and all its associated data.
   * @param promptId - Identifier of the prompt to permanently delete.
   */
  public permanentlyDeletePrompt(promptId: PromptId): void {
    return this.telemetry.withSpan("service.permanentlyDeletePrompt", { promptId }, () => {
      // Ensure the prompt exists (could be deleted or not)
      this.repository.getPromptById(promptId);

      this.repository.permanentlyDeletePrompt(promptId);
      this.logger.info("prompt_permanently_deleted", { promptId });
      // Note: Plugin events for permanent delete not implemented yet
    });
  }

  /**
   * Import a prompt from an external file.
   * @param filePath - Path to the file to import.
   * @param options - Import options.
   * @returns The imported prompt.
   */
  public importPromptFromFile(
    filePath: string,
    options: {
      name?: string;
      tags?: readonly string[];
      format?: PromptFormat;
    } = {}
  ): Prompt {
    return this.telemetry.withSpan("service.importPromptFromFile", { filePath }, () => {
      // Check file size before reading
      const stats = fs.statSync(filePath);
      if (stats.size > this.limits.maxFileSizeBytes) {
        throw new ValidationError([`File size ${stats.size} bytes exceeds maximum allowed size of ${this.limits.maxFileSizeBytes} bytes`]);
      }

      // Read file content
      const content = fs.readFileSync(filePath, 'utf-8');

      // Check content length
      if (content.length > this.limits.maxPromptContentLength) {
        throw new ValidationError([`Prompt content length ${content.length} characters exceeds maximum allowed length of ${this.limits.maxPromptContentLength} characters`]);
      }

      // Detect format from file extension if not provided
      const format = options.format || this.detectFormatFromPath(filePath);

      // Generate slug from name or filename
      const baseName = options.name || path.basename(filePath, path.extname(filePath));
      const slug = this.generateSlug(baseName);

      // Create the prompt
      const promptInput = {
        id: randomUUID(),
        slug,
        title: baseName,
        description: `Imported from ${filePath}`,
        body: content,
        format,
        semanticVersion: '1.0.0',
        tags: [...(options.tags || [])],
        changelog: 'Initial import',
      };

      const prompt = this.createPrompt(promptInput);
      this.logger.info("prompt_imported", { promptId: prompt.id, filePath });
      return prompt;
    });
  }

  /**
   * Export a prompt to a file.
   * @param promptId - Identifier of the prompt to export.
   * @param filePath - Path where to save the exported file.
   * @param options - Export options.
   */
  public exportPromptToFile(
    promptId: PromptId,
    filePath: string,
    options: {
      format?: PromptFormat;
      includeMetadata?: boolean;
    } = {}
  ): void {
    return this.telemetry.withSpan("service.exportPromptToFile", { promptId, filePath }, () => {
      const prompt = this.repository.getPromptById(promptId);
      if (!prompt.latestVersion) {
        throw new ValidationError(['Prompt has no content to export']);
      }

      let content = prompt.latestVersion.body;

      // Convert format if requested
      if (options.format && options.format !== prompt.latestVersion.format) {
        content = convertPromptContent(content, prompt.latestVersion.format, options.format);
      }

      // Add metadata if requested
      if (options.includeMetadata) {
        const metadata = {
          id: prompt.id,
          slug: prompt.slug,
          title: prompt.title,
          description: prompt.description,
          tags: prompt.tags.map(tag => tag.label),
          format: options.format || prompt.latestVersion.format,
          version: prompt.latestVersion.semanticVersion,
          exportedAt: new Date().toISOString(),
        };

        if (options.format === 'json') {
          content = JSON.stringify({ metadata, content }, null, 2);
        } else if (options.format === 'yaml') {
          content = yaml.stringify({ metadata }) + '---\n' + content;
        } else {
          // Markdown format
          content = '---\n' + yaml.stringify(metadata) + '---\n\n' + content;
        }
      }

      // Write to file
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, content, 'utf-8');

      this.logger.info("prompt_exported", { promptId, filePath });
    });
  }

  private detectFormatFromPath(filePath: string): PromptFormat {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.yaml':
      case '.yml':
        return 'yaml';
      case '.json':
        return 'json';
      case '.md':
      default:
        return 'markdown';
    }
  }

  private generateSlug(baseName: string): string {
    return baseName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);
  }

  private prepareTags(labels: readonly string[], existingLabels: ReadonlySet<string> = new Set()): Tag[] {
    const seen = new Set<string>(Array.from(existingLabels, (label) => label.toLowerCase()));

    return this.normalizeLabels(labels)
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

  private normalizeLabels(labels: readonly string[]): string[] {
    return labels
      .map((label) => label.trim())
      .filter((label) => label.length > 0);
  }

  /**
   * Run comprehensive diagnostics on the prompt library.
   * @returns Diagnostic report with issues and statistics.
   */
  public runDiagnostics(): {
    summary: {
      totalPrompts: number;
      totalVersions: number;
      totalTags: number;
      deletedPrompts: number;
      orphanedTags: number;
      invalidContent: number;
    };
    issues: Array<{
      type: 'error' | 'warning';
      message: string;
      promptId?: string;
      details?: unknown;
    }>;
  } {
    return this.telemetry.withSpan("service.runDiagnostics", {}, () => {
      const issues: Array<{
        type: 'error' | 'warning';
        message: string;
        promptId?: string;
        details?: unknown;
      }> = [];

      // Get basic statistics
      const allPrompts = this.repository.getAllPrompts();
      const deletedPrompts = this.repository.getDeletedPrompts();
      const allTags = this.repository.getAllTags();

      let totalVersions = 0;
      let invalidContent = 0;
      let orphanedTags = 0;

      // Check each prompt for issues
      for (const prompt of allPrompts) {
        // Check for prompts without versions
        if (!prompt.latestVersion) {
          issues.push({
            type: 'error',
            message: 'Prompt has no versions',
            promptId: prompt.id,
          });
        } else {
          totalVersions++;

          // Validate content format
          try {
            validatePromptContent(prompt.latestVersion.body, prompt.latestVersion.format);
          } catch (error) {
            invalidContent++;
            issues.push({
              type: 'error',
              message: `Invalid ${prompt.latestVersion.format} content`,
              promptId: prompt.id,
              details: error instanceof Error ? error.message : error,
            });
          }
        }

      // Check for orphaned tags (tags not linked to prompts)
      for (const prompt of allPrompts) {
        const linkedTagIds = new Set(prompt.tags.map((tag: Tag) => tag.id));
        for (const tag of allTags) {
          if (!linkedTagIds.has(tag.id)) {
            orphanedTags++;
          }
        }
      }
      }

      // Check database integrity
      try {
        this.repository.getDatabase().exec('PRAGMA integrity_check');
      } catch (error) {
        issues.push({
          type: 'error',
          message: 'Database integrity check failed',
          details: error instanceof Error ? error.message : error,
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
        issues,
      };
    });
  }

  /**
   * Get library statistics and analytics.
   * @returns Comprehensive statistics about the prompt library.
   */
  public getLibraryStats(): {
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
  } {
    return this.telemetry.withSpan("service.getLibraryStats", {}, () => {
      const allPrompts = this.repository.getAllPrompts();
      const deletedPrompts = this.repository.getDeletedPrompts();
      const allTags = this.repository.getAllTags();

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
      const createdThisWeek = allPrompts.filter((p: Prompt) => p.createdAt >= weekAgo).length;
      const updatedThisWeek = allPrompts.filter((p: Prompt) => p.updatedAt >= weekAgo).length;
      const deletedThisWeek = deletedPrompts.filter((p: Prompt) => p.deletedAt && p.deletedAt >= weekAgo).length;

      return {
        prompts: {
          total: allPrompts.length,
          active: allPrompts.length - deletedPrompts.length,
          deleted: deletedPrompts.length,
          byFormat: formatCounts,
        },
        tags: {
          total: allTags.length,
          averagePerPrompt: allPrompts.length > 0 ? allTags.length / allPrompts.length : 0,
          mostUsed: mostUsedTags,
        },
        versions: {
          total: totalVersions,
          averagePerPrompt: allPrompts.length > 0 ? totalVersions / allPrompts.length : 0,
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
   * @returns Report of repairs performed.
   */
  public repairIntegrity(): {
    repairs: Array<{
      type: string;
      description: string;
      count: number;
    }>;
    errors: Array<{
      message: string;
      details?: unknown;
    }>;
  } {
    return this.telemetry.withSpan("service.repairIntegrity", {}, () => {
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
        const diagnostics = this.runDiagnostics();

        // Attempt to repair invalid content by re-validating
        if (diagnostics.summary.invalidContent > 0) {
          let repaired = 0;
          for (const issue of diagnostics.issues) {
            if (issue.type === 'error' && issue.message.includes('Invalid') && issue.promptId) {
              try {
                const prompt = this.repository.getPromptById(issue.promptId);
                if (prompt.latestVersion) {
                  // Try to detect and fix format
                  const detectedFormat = detectPromptFormat(prompt.latestVersion.body);
                  if (detectedFormat !== prompt.latestVersion.format) {
                    // Update the format in the database
                    this.repository.updateVersionFormat(prompt.latestVersion.id, detectedFormat);
                    repaired++;
                  }
                }
              } catch (repairError) {
                errors.push({
                  message: `Failed to repair prompt ${issue.promptId}`,
                  details: repairError instanceof Error ? repairError.message : repairError,
                });
              }
            }
          }

          if (repaired > 0) {
            repairs.push({
              type: 'content_format',
              description: 'Fixed invalid content formats by auto-detection',
              count: repaired,
            });
          }
        }

        // Clean up orphaned tags (tags not linked to any prompts)
        if (diagnostics.summary.orphanedTags > 0) {
          // This would require more complex logic to identify truly orphaned tags
          // For now, we'll just report them
          repairs.push({
            type: 'orphaned_tags',
            description: 'Orphaned tags detected (manual cleanup required)',
            count: diagnostics.summary.orphanedTags,
          });
        }

      } catch (error) {
        errors.push({
          message: 'Integrity repair failed',
          details: error instanceof Error ? error.message : error,
        });
      }

      return { repairs, errors };
    });
  }

  /**
   * Get the plugin host for accessing registered plugins and connectors.
   * @returns The plugin host instance.
   */
  public getPluginHost(): PluginHost {
    return this.pluginHost;
  }
}
