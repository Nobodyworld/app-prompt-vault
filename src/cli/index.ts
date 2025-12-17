#!/usr/bin/env node
/**
 * @fileoverview Command Line Interface for Prompt Vault
 *
 * This module provides a comprehensive CLI for managing prompt libraries through
 * the PromptVaultService. It supports all core operations including creating,
 * listing, searching, versioning, and managing prompts with full observability
 * and plugin support.
 *
 * Key Features:
 * - Full CRUD operations for prompts and versions
 * - Advanced search and filtering capabilities
 * - Tag management and organization
 * - Import/export functionality
 * - Backup and restore operations
 * - Comprehensive diagnostics and statistics
 * - Plugin system integration
 * - Telemetry and structured logging
 *
 * Usage Examples:
 * ```bash
 * # Create a new prompt
 * npm run dev -- create --slug my-prompt --title "My Prompt" --body "Hello world"
 *
 * # List prompts with search
 * npm run dev -- list --text "hello" --tags "greeting,welcome"
 *
 * # Add version to existing prompt
 * npm run dev -- version --id <uuid> --body "Updated content" --version "1.1.0"
 *
 * # Run diagnostics
 * npm run dev -- diagnostics
 * ```
 *
 * @author Prompt Vault Team
 * @version 0.1.0
 * @since 2024
 */

import { Command } from "commander";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import chalk from "chalk";
import { randomUUID } from "node:crypto";
import { PromptVaultService } from "../services/PromptVaultService.js";
import { bootstrapObservabilityFromEnv } from "../observability/index.js";
import {
  createAuditTrailPlugin,
  createOperationalTelemetryPlugin,
  type PromptVaultPlugin,
} from "../extensions/index.js";
import fs from "fs/promises";
import path from "path";

const program = new Command();

/**
 * Default database path resolution relative to the CLI script location.
 * Points to 'prompt-vault.db' in the project root directory.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const defaultDbPath = resolve(__dirname, "..", "..", "prompt-vault.db");

/**
 * Global observability setup for the CLI application.
 * Initializes telemetry, logging, and health indicators with service-specific configuration.
 */
const observability = bootstrapObservabilityFromEnv({
  serviceName: "prompt-vault-cli",
});
const telemetry = observability.telemetry;
const logger = observability.logger.child({ component: "cli" });
observability.indicator.setLiveness({ status: "ok" });
observability.indicator.setReadiness({
  status: "degraded",
  details: { reason: "idle" },
});

/**
 * Gracefully shuts down observability components when the process terminates.
 * Ensures all telemetry data is flushed and connections are properly closed.
 *
 * @returns Promise that resolves when shutdown is complete
 */
async function shutdownObservability(): Promise<void> {
  await observability.shutdown();
}

// Signal handlers for graceful shutdown
process.once("SIGINT", async () => {
  await shutdownObservability();
  process.exit(130);
});

process.once("SIGTERM", async () => {
  await shutdownObservability();
  process.exit(143);
});

process.on("exit", () => {
  void shutdownObservability();
});

/**
 * Service lifecycle helper that manages database connections and service initialization.
 *
 * This function provides a standardized way to:
 * - Establish database connections with proper error handling
 * - Initialize the PromptVaultService with all required dependencies
 * - Load and configure plugins from multiple sources
 * - Execute user operations within a controlled service context
 * - Ensure proper cleanup of resources after operation completion
 *
 * The service is configured with:
 * - Telemetry and logging instrumentation
 * - Plugin system with built-in and external plugins
 * - Configurable limits for file sizes and content lengths
 * - Transaction-safe database operations
 *
 * @template T - The return type of the handler function
 * @param dbPath - Absolute path to the SQLite database file
 * @param handler - Callback function that receives the initialized service and raw database connection
 * @returns Promise that resolves with the handler's return value
 *
 * @example
 * ```typescript
 * await useService('./prompt-vault.db', async (service, db) => {
 *   const prompt = service.createPrompt({
 *     id: randomUUID(),
 *     slug: 'example',
 *     title: 'Example Prompt',
 *     body: 'Hello World',
 *     format: 'markdown',
 *     semanticVersion: '1.0.0',
 *     tags: []
 *   });
 *   return prompt;
 * });
 * ```
 *
 * @throws Will throw if database connection fails or service initialization encounters errors
 */
async function useService<T>(
  dbPath: string,
  handler: (
    service: PromptVaultService,
    database: Database.Database,
  ) => Promise<T> | T,
): Promise<T> {
  observability.indicator.setReadiness({
    status: "degraded",
    details: { reason: "connecting" },
  });
  const database = new Database(dbPath);
  observability.indicator.setReadiness({ status: "ok" });

  // Load plugins
  const plugins = await loadPlugins();

  // Load limits from environment variables
  const maxFileSizeBytes = process.env.PROMPT_VAULT_MAX_FILE_SIZE_BYTES
    ? Number.parseInt(process.env.PROMPT_VAULT_MAX_FILE_SIZE_BYTES, 10)
    : 10 * 1024 * 1024; // 10MB default
  const maxPromptContentLength = process.env
    .PROMPT_VAULT_MAX_PROMPT_CONTENT_LENGTH
    ? Number.parseInt(process.env.PROMPT_VAULT_MAX_PROMPT_CONTENT_LENGTH, 10)
    : 100 * 1024; // 100KB default

  const service = new PromptVaultService(database, {
    telemetry,
    logger: logger.child({ component: "service", dbPath }),
    plugins,
    limits: {
      maxFileSizeBytes,
      maxPromptContentLength,
    },
  });
  try {
    return await handler(service, database);
  } catch (error) {
    logger.error("cli_handler_failed", {
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  } finally {
    database.close();
    observability.indicator.setReadiness({
      status: "degraded",
      details: { reason: "idle" },
    });
  }
}

/**
 * Loads and initializes all available plugins for the service.
 *
 * This function combines built-in plugins with external plugins discovered from
 * configured directories. It handles plugin loading errors gracefully, logging
 * warnings for failed external plugins while continuing with successfully loaded ones.
 *
 * Built-in plugins include:
 * - Audit Trail Plugin: Tracks all data modifications for compliance
 * - Operational Telemetry Plugin: Provides operational metrics and monitoring
 *
 * External plugins are loaded from directories specified in the PROMPT_VAULT_PLUGIN_DIRS
 * environment variable or default locations ('./plugins' and './plugins' in cwd).
 *
 * @returns Promise that resolves to an array of successfully loaded plugins
 *
 * @example
 * ```typescript
 * const plugins = await loadPlugins();
 * console.log(`Loaded ${plugins.length} plugins`);
 * ```
 */
async function loadPlugins(): Promise<PromptVaultPlugin[]> {
  const plugins: PromptVaultPlugin[] = [
    createAuditTrailPlugin(),
    createOperationalTelemetryPlugin(),
  ];

  // Load external plugins from environment or default directories
  const pluginDirs = process.env.PROMPT_VAULT_PLUGIN_DIRS?.split(",") || [
    "./plugins",
    path.join(process.cwd(), "plugins"),
  ];

  try {
    const { PluginLoader } = await import("../extensions/index.js");
    const loader = new PluginLoader({
      pluginDirs,
      logger: logger.child({ component: "plugin-loader" }),
    });

    const discoveredPlugins = loader.discoverPlugins();
    logger.info("discovered_external_plugins", {
      count: discoveredPlugins.length,
    });

    for (const metadata of discoveredPlugins) {
      try {
        const plugin = await loader.loadPlugin(metadata);
        if (plugin) {
          plugins.push(plugin);
          logger.info("loaded_external_plugin", { name: plugin.name });
        }
      } catch (error) {
        logger.warn("failed_to_load_external_plugin", {
          name: metadata.name,
          path: metadata.path,
          error: error instanceof Error ? error.message : error,
        });
      }
    }
  } catch (error) {
    logger.warn("plugin_discovery_failed", {
      error: error instanceof Error ? error.message : error,
    });
  }

  return plugins;
}

// Configure the main CLI program with metadata and command definitions
program
  .name("prompt-vault")
  .description("Manage your reusable prompt library from the command line.")
  .version("0.2.0");

function parseTags(tags?: string): string[] | undefined {
  if (!tags) return undefined;
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseLimit(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNumberOption(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

type DiagnosticsReport = Awaited<
  ReturnType<PromptVaultService["runDiagnostics"]>
>;

function printDiagnosticsReport(
  report: DiagnosticsReport,
  heading: string,
): void {
  console.log(chalk.bold(`\n${heading}\n`));

  console.log(chalk.blue("Summary:"));
  console.log(`  Total Prompts: ${report.summary.totalPrompts}`);
  console.log(`  Total Versions: ${report.summary.totalVersions}`);
  console.log(`  Total Tags: ${report.summary.totalTags}`);
  console.log(`  Deleted Prompts: ${report.summary.deletedPrompts}`);
  console.log(`  Orphaned Tags: ${report.summary.orphanedTags}`);
  console.log(`  Invalid Content: ${report.summary.invalidContent}`);

  console.log(chalk.blue("\nMigrations:"));
  console.log(`  Current Version: ${report.migration.currentVersion}`);
  console.log(`  Latest Version: ${report.migration.latestVersion}`);
  if (report.migration.pendingVersions.length > 0) {
    console.log(
      chalk.red(`  Pending: ${report.migration.pendingVersions.join(", ")}`),
    );
  } else {
    console.log(chalk.green("  Pending: none"));
  }

  console.log(chalk.blue("\nIntegrity:"));
  console.log(
    `  Status: ${report.integrity.status === "ok" ? chalk.green("ok") : chalk.red("error")}`,
  );
  if (report.integrity.details) {
    console.log(`  Details: ${report.integrity.details}`);
  }

  if (report.issues.length > 0) {
    console.log(chalk.yellow("\n⚠️  Issues Found:"));
    for (const issue of report.issues) {
      const icon =
        issue.type === "error" ? chalk.red("❌") : chalk.yellow("⚠️");
      const promptInfo = issue.promptId ? ` (Prompt: ${issue.promptId})` : "";
      console.log(`  ${icon} ${issue.message}${promptInfo}`);
      if (issue.details) {
        console.log(
          `    Details: ${typeof issue.details === "string" ? issue.details : JSON.stringify(issue.details)}`,
        );
      }
    }
  } else {
    console.log(chalk.green("\n✅ No issues found!"));
  }
}

program
  .command("export-buttons")
  .description(
    "Export prompts as a Buttons switchboard payload (JSON to stdout)",
  )
  .option("--text <query>", "Text to search within prompts")
  .option("--tags <tags>", "Comma separated tags to filter by")
  .option("--limit <number>", "Max phrases to include (default: 12)")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    const limit = parseLimit(options.limit, 12);
    await useService(options.db, async (service) => {
      const results = await service.searchPrompts({
        text: options.text,
        tags: parseTags(options.tags),
      });
      const payload = service.exportButtonsSwitchboard(results.prompts, limit);
      if (!payload) {
        console.error(chalk.yellow("No prompts with bodies to export."));
        return;
      }
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    });
  });

program
  .command("export-planner")
  .description("Export prompts as a Planner bucket draft (JSON to stdout)")
  .option("--text <query>", "Text to search within prompts")
  .option("--tags <tags>", "Comma separated tags to filter by")
  .option("--limit <number>", "Max tasks to include (default: 10)")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    const limit = parseLimit(options.limit, 10);
    await useService(options.db, async (service) => {
      const results = await service.searchPrompts({
        text: options.text,
        tags: parseTags(options.tags),
      });
      const payload = service.exportPlannerBucket(results.prompts, limit);
      if (!payload) {
        console.error(chalk.yellow("No prompts available to export."));
        return;
      }
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    });
  });

program
  .command("create")
  .description("Create a new prompt with an initial version")
  .requiredOption("--slug <slug>", "Unique slug for the prompt")
  .requiredOption("--title <title>", "Title for the prompt")
  .requiredOption("--body <body>", "Prompt body text")
  .option("--version <version>", "Semantic version", "1.0.0")
  .option(
    "--format <format>",
    "Content format (markdown, yaml, json)",
    "markdown",
  )
  .option("--description <description>", "Optional description")
  .option("--tags <tags>", "Comma separated tag labels", "")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, async (service) => {
      const tags = options.tags
        ? (options.tags as string)
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : [];

      const prompt = await service.createPrompt({
        id: randomUUID(),
        slug: options.slug,
        title: options.title,
        description: options.description,
        body: options.body,
        format: options.format,
        semanticVersion: options.version,
        tags,
        changelog: undefined,
      });

      console.log(
        chalk.green(
          `Created prompt ${prompt.title} (${prompt.slug}) in ${options.format} format`,
        ),
      );
      telemetry.recordEvent("cli.prompt_created", { promptId: prompt.id });
    });
  });

program
  .command("list")
  .description("List prompts with optional filters")
  .option("--text <text>", "Search text")
  .option("--tags <tags>", "Comma separated tag filters")
  .option("--formats <formats>", "Comma separated format filters")
  .option("--page <page>", "Page number", "0")
  .option("--page-size <size>", "Page size", "10")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, async (service) => {
      const tags = options.tags
        ? (options.tags as string)
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : undefined;
      const formats = options.formats
        ? ((options.formats as string)
            .split(",")
            .map((format) => format.trim())
            .filter(Boolean) as ("markdown" | "yaml" | "json")[])
        : undefined;
      const result = await service.searchPrompts({
        text: options.text,
        tags,
        formats,
        page: Number.parseInt(options.page as string, 10),
        pageSize: Number.parseInt(options.pageSize as string, 10),
      });

      if (result.prompts.length === 0) {
        console.log(chalk.yellow("No prompts found."));
        return;
      }

      for (const prompt of result.prompts) {
        console.log(chalk.cyan(`- ${prompt.title} (${prompt.slug})`));
        console.log(chalk.gray(`  ID: ${prompt.id}`));
        if (prompt.latestVersion) {
          console.log(
            chalk.gray(
              `  latest v${prompt.latestVersion.semanticVersion} (${prompt.latestVersion.format}) updated ${prompt.latestVersion.updatedAt.toISOString()}`,
            ),
          );
        }
        if (prompt.tags.length > 0) {
          console.log(
            chalk.magenta(
              `  tags: ${prompt.tags.map((tag) => tag.label).join(", ")}`,
            ),
          );
        }
      }
    });
  });

program
  .command("search")
  .description("Search prompts and view match excerpts")
  .option("--text <text>", "Search text across title, description, and body")
  .option("--tags <tags>", "Comma separated tag filters")
  .option("--formats <formats>", "Comma separated format filters")
  .option("--page <page>", "Page number", "0")
  .option("--page-size <size>", "Page size", "20")
  .option("--case-sensitive", "Enable case-sensitive search")
  .option("--max-results <number>", "Maximum prompts to return", "20")
  .option("--max-matches <number>", "Maximum matches per prompt", "3")
  .option(
    "--max-total-matches <number>",
    "Maximum total matches across prompts",
    "100",
  )
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, async (service) => {
      const tags = parseTags(options.tags);
      const formats = options.formats
        ? ((options.formats as string)
            .split(",")
            .map((format) => format.trim())
            .filter(Boolean) as ("markdown" | "yaml" | "json")[])
        : undefined;

      const result = await service.advancedSearchPrompts({
        text: options.text,
        tags,
        formats,
        page: parseNumberOption(options.page, 0),
        pageSize: parseNumberOption(options.pageSize, 20),
        caseSensitive: Boolean(options.caseSensitive),
        maxResults: parseLimit(options.maxResults, 20),
        maxMatchesPerRule: parseLimit(options.maxMatches, 3),
        maxTotalMatches: parseLimit(options.maxTotalMatches, 100),
      });

      if (result.matches.length === 0) {
        console.log(chalk.yellow("No prompts found."));
        return;
      }

      const highlightExcerpt = (
        excerpt: string,
        position: number,
        length: number,
      ): string => {
        if (position < 0 || length <= 0 || position >= excerpt.length) {
          return excerpt;
        }

        return `${excerpt.slice(0, position)}${chalk.yellow(excerpt.slice(position, position + length))}${excerpt.slice(position + length)}`;
      };

      console.log(
        chalk.bold(
          `Found ${result.matches.length} prompt(s) (page ${result.page + 1})`,
        ),
      );
      console.log(chalk.gray(`Total matches: ${result.totalMatches}`));

      for (const match of result.matches) {
        const prompt = match.prompt;
        console.log(
          chalk.cyan(`\n- ${prompt.title ?? prompt.slug} (${prompt.slug})`),
        );
        console.log(chalk.gray(`  ID: ${prompt.id}`));
        if (prompt.latestVersion) {
          console.log(
            chalk.gray(
              `  latest v${prompt.latestVersion.semanticVersion} (${prompt.latestVersion.format}) updated ${prompt.latestVersion.updatedAt.toISOString()}`,
            ),
          );
        }

        if (prompt.tags.length > 0) {
          console.log(
            chalk.magenta(
              `  tags: ${prompt.tags.map((tag) => tag.label).join(", ")}`,
            ),
          );
        }

        for (const snippet of match.matches) {
          const highlighted = highlightExcerpt(
            snippet.excerpt,
            snippet.position,
            snippet.length,
          );
          console.log(`    • ${highlighted}`);
        }
      }
    });
  });

program
  .command("tag")
  .description("Apply tags to an existing prompt")
  .requiredOption("--id <id>", "Prompt identifier")
  .requiredOption("--tags <tags>", "Comma separated tags")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, async (service) => {
      const labels = (options.tags as string)
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      await service.tagPrompt(options.id, labels);
      console.log(
        chalk.green(`Tagged prompt ${options.id} with ${labels.join(", ")}`),
      );
    });
  });

program
  .command("untag")
  .description("Remove tags from an existing prompt")
  .requiredOption("--id <id>", "Prompt identifier")
  .requiredOption("--tags <tags>", "Comma separated tags to remove")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, async (service) => {
      const labels = (options.tags as string)
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      await service.untagPrompt(options.id, labels);
      console.log(
        chalk.green(
          `Removed tags ${labels.join(", ")} from prompt ${options.id}`,
        ),
      );
    });
  });

program
  .command("version")
  .description("Add a new version to a prompt")
  .requiredOption("--id <id>", "Prompt identifier")
  .requiredOption("--body <body>", "Prompt body text")
  .option("--version <version>", "Semantic version", "1.0.0")
  .option(
    "--format <format>",
    "Content format (markdown, yaml, json)",
    "markdown",
  )
  .option("--changelog <changelog>", "Changelog text")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, (service) => {
      const version = service.addVersion(
        options.id,
        options.body,
        options.version,
        options.format,
        options.changelog,
      );
      console.log(
        chalk.green(
          `Added version ${version.semanticVersion} to prompt ${options.id} in ${options.format} format`,
        ),
      );
    });
  });

program
  .command("import")
  .description("Import a prompt from an external file")
  .requiredOption("--file <path>", "Path to the file to import")
  .option(
    "--name <name>",
    "Name for the imported prompt (defaults to filename)",
  )
  .option("--tags <tags>", "Comma separated tag labels", "")
  .option(
    "--format <format>",
    "Content format (markdown, yaml, json) - auto-detected if not specified",
  )
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, async (service) => {
      const tags = options.tags
        ? (options.tags as string)
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : [];

      const prompt = await service.importPromptFromFile(options.file, {
        name: options.name,
        tags,
        format: options.format,
      });

      console.log(
        chalk.green(
          `Imported prompt "${prompt.title}" (${prompt.slug}) from ${options.file}`,
        ),
      );
      telemetry.recordEvent("cli.prompt_imported", {
        promptId: prompt.id,
        filePath: options.file,
      });
    });
  });

program
  .command("export")
  .description("Export a prompt to a file")
  .requiredOption("--id <id>", "Prompt identifier")
  .requiredOption("--output <path>", "Path where to save the exported file")
  .option("--format <format>", "Target format (markdown, yaml, json)")
  .option("--include-metadata", "Include metadata in the exported file")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, async (service) => {
      await service.exportPromptToFile(options.id, options.output, {
        format: options.format,
        includeMetadata: options.includeMetadata,
      });

      console.log(
        chalk.green(`Exported prompt ${options.id} to ${options.output}`),
      );
      telemetry.recordEvent("cli.prompt_exported", {
        promptId: options.id,
        filePath: options.output,
      });
    });
  });

program
  .command("bulk-import")
  .description("Import multiple prompts from files in bulk")
  .requiredOption(
    "--files <files>",
    "Comma-separated list of file paths to import",
  )
  .option(
    "--tags <tags>",
    "Comma separated tag labels to apply to all prompts",
    "",
  )
  .option("--category <category>", "Category to assign to all imported prompts")
  .option(
    "--format <format>",
    "Format override for all files (markdown, yaml, json) - auto-detected if not specified",
  )
  .option("--skip-errors", "Continue importing other files if one fails")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, async (service) => {
      const filePaths = (options.files as string)
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean);
      const tags = options.tags
        ? (options.tags as string)
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : [];

      console.log(chalk.blue(`Importing ${filePaths.length} files...`));

      const result = await service.bulkImportPrompts(filePaths, {
        tags,
        category: options.category,
        format: options.format,
        skipErrors: options.skipErrors,
      });

      console.log(
        chalk.green(
          `✅ Successfully imported ${result.successful.length} prompts`,
        ),
      );

      if (result.failed.length > 0) {
        console.log(
          chalk.yellow(`⚠️  Failed to import ${result.failed.length} files:`),
        );
        for (const failure of result.failed) {
          console.log(chalk.red(`  • ${failure.filePath}: ${failure.error}`));
        }
      }

      telemetry.recordEvent("cli.bulk_import_completed", {
        totalFiles: filePaths.length,
        successful: result.successful.length,
        failed: result.failed.length,
      });
    });
  });

program
  .command("bulk-export")
  .description("Export multiple prompts to files in bulk")
  .requiredOption("--ids <ids>", "Comma-separated list of prompt IDs to export")
  .requiredOption(
    "--output-dir <path>",
    "Directory where files will be created",
  )
  .option(
    "--format <format>",
    "Target format for all exports (markdown, yaml, json)",
  )
  .option("--include-metadata", "Include metadata in exported files")
  .option(
    "--naming-pattern <pattern>",
    "Filename pattern using {slug}, {title}, or {id}",
    "{slug}",
  )
  .option("--skip-errors", "Continue exporting other prompts if one fails")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, async (service) => {
      const promptIds = (options.ids as string)
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

      console.log(
        chalk.blue(
          `Exporting ${promptIds.length} prompts to ${options.outputDir}...`,
        ),
      );

      const result = await service.bulkExportPrompts(
        promptIds,
        options.outputDir,
        {
          format: options.format,
          includeMetadata: options.includeMetadata,
          namingPattern: options.namingPattern,
          skipErrors: options.skipErrors,
        },
      );

      console.log(
        chalk.green(
          `✅ Successfully exported ${result.successful.length} prompts to ${result.outputDir}`,
        ),
      );

      if (result.failed.length > 0) {
        console.log(
          chalk.yellow(`⚠️  Failed to export ${result.failed.length} prompts:`),
        );
        for (const failure of result.failed) {
          console.log(chalk.red(`  • ${failure.promptId}: ${failure.error}`));
        }
      }

      telemetry.recordEvent("cli.bulk_export_completed", {
        totalPrompts: promptIds.length,
        successful: result.successful.length,
        failed: result.failed.length,
        outputDir: result.outputDir,
      });
    });
  });

program
  .command("backup")
  .description("Create a compressed backup snapshot of the database")
  .requiredOption(
    "--output <path>",
    "Path where the compressed snapshot should be saved",
  )
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, async (service) => {
      await service.createSnapshot(options.output);
      console.log(chalk.green(`Database snapshot created: ${options.output}`));
    });
  });

program
  .command("restore")
  .description("Restore database from a compressed snapshot")
  .requiredOption("--input <path>", "Path to the compressed snapshot file")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, async (service) => {
      const isValid = await service.validateSnapshot(options.input);
      if (!isValid) {
        console.error(
          chalk.red(`Invalid or corrupted snapshot file: ${options.input}`),
        );
        process.exit(1);
      }

      await service.restoreSnapshot(options.input);
      console.log(
        chalk.green(`Database restored from snapshot: ${options.input}`),
      );
    });
  });

program
  .command("info")
  .description("Get information about a snapshot file")
  .requiredOption("--input <path>", "Path to the snapshot file")
  .action(async (options) => {
    const { SnapshotManager } = await import("../domain/snapshot.js");
    const info = await SnapshotManager.getSnapshotInfo(options.input);
    console.log(chalk.bold("Snapshot Information"));
    console.log(`Path: ${options.input}`);
    console.log(`Size: ${info.size} bytes`);
    console.log(`Created: ${info.created.toISOString()}`);
    console.log(`Compressed: ${info.compressed ? "Yes" : "No"}`);
  });

program
  .command("delete")
  .description("Soft delete a prompt (move to trash)")
  .requiredOption("--id <id>", "Prompt identifier")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, async (service) => {
      await service.softDeletePrompt(options.id);
      console.log(chalk.green(`Prompt ${options.id} moved to trash`));
    });
  });

program
  .command("restore-deleted")
  .description("Restore a soft deleted prompt from trash")
  .requiredOption("--id <id>", "Prompt identifier")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, async (service) => {
      await service.restorePrompt(options.id);
      console.log(chalk.green(`Prompt ${options.id} restored from trash`));
    });
  });

program
  .command("list-deleted")
  .description("List all soft deleted prompts in trash")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, async (service) => {
      const deletedPrompts = await service.getDeletedPrompts();

      if (deletedPrompts.length === 0) {
        console.log(chalk.yellow("No deleted prompts found."));
        return;
      }

      console.log(
        chalk.bold(`Found ${deletedPrompts.length} deleted prompts:`),
      );
      console.log();

      for (const prompt of deletedPrompts) {
        console.log(chalk.red(`- ${prompt.title} (${prompt.slug})`));
        console.log(chalk.gray(`  ID: ${prompt.id}`));
        if (prompt.description) {
          console.log(chalk.gray(`  Description: ${prompt.description}`));
        }
        if (prompt.deletedAt) {
          console.log(
            chalk.gray(`  Deleted: ${prompt.deletedAt.toISOString()}`),
          );
        }
        if (prompt.tags.length > 0) {
          console.log(
            chalk.magenta(
              `  Tags: ${prompt.tags.map((tag) => tag.label).join(", ")}`,
            ),
          );
        }
        console.log();
      }
    });
  });

program
  .command("permanently-delete")
  .description(
    "Permanently delete a prompt and all its data (cannot be undone)",
  )
  .requiredOption("--id <id>", "Prompt identifier")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, async (service) => {
      await service.permanentlyDeletePrompt(options.id);
      console.log(chalk.red(`Prompt ${options.id} permanently deleted`));
    });
  });

program
  .command("edit")
  .description("Open a prompt in VS Code for editing")
  .requiredOption("--id <id>", "Prompt identifier")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, async (service) => {
      const prompt = await service.getPrompt(options.id);
      if (!prompt.latestVersion) {
        console.error(chalk.red(`Prompt ${options.id} has no content to edit`));
        process.exit(1);
      }

      // Create a temporary file for VS Code to edit
      const tempDir = path.join(process.cwd(), "temp");
      await fs.mkdir(tempDir, { recursive: true });

      const extension =
        prompt.latestVersion.format === "markdown"
          ? "md"
          : prompt.latestVersion.format === "yaml"
            ? "yaml"
            : prompt.latestVersion.format === "json"
              ? "json"
              : "txt";
      const tempFile = path.join(tempDir, `${prompt.slug}.${extension}`);

      // Write current content to temp file
      await fs.writeFile(tempFile, prompt.latestVersion.body, "utf-8");

      console.log(chalk.green(`Opening ${prompt.title} in VS Code...`));
      console.log(
        chalk.gray(
          `Edit the file and save your changes. The prompt will be updated automatically.`,
        ),
      );
      console.log(chalk.gray(`File: ${tempFile}`));

      try {
        // Open in VS Code
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(exec);

        await execAsync(`code "${tempFile}"`);

        // Wait for user to finish editing (they can close VS Code when done)
        console.log(
          chalk.yellow(
            `\nPress Enter when you've finished editing in VS Code...`,
          ),
        );
        process.stdin.setRawMode(true);
        process.stdin.resume();
        await new Promise<void>((resolve) => {
          process.stdin.once("data", () => {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            resolve();
          });
        });

        // Read the edited content
        const editedContent = await fs.readFile(tempFile, "utf-8");

        // Check if content changed
        if (editedContent !== prompt.latestVersion.body) {
          // Generate next version number
          const currentVersion = prompt.latestVersion.semanticVersion;
          const versionParts = currentVersion.split(".");
          const patch = parseInt(versionParts[2] || "0", 10) + 1;
          const nextVersion = `${versionParts[0]}.${versionParts[1]}.${patch}`;

          // Create new version with edited content
          service.addVersion(
            options.id,
            editedContent,
            nextVersion,
            prompt.latestVersion.format,
            "Edited in VS Code",
          );
          console.log(
            chalk.green(`✓ Prompt "${prompt.title}" updated successfully!`),
          );
        } else {
          console.log(
            chalk.blue(`No changes detected for prompt "${prompt.title}"`),
          );
        }

        // Clean up temp file
        await fs.unlink(tempFile);
      } catch (error) {
        console.error(
          chalk.red(
            `Failed to open in VS Code: ${error instanceof Error ? error.message : error}`,
          ),
        );
        process.exit(1);
      }
    });
  });

program
  .command("diagnostics")
  .description("Run comprehensive diagnostics on the prompt library")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, async (service) => {
      const report = await service.runDiagnostics();
      printDiagnosticsReport(report, "📊 Library Diagnostics Report");
    });
  });

program
  .command("doctor")
  .description("Run doctor checks including migrations and integrity")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, async (service) => {
      const report = await service.runDiagnostics();
      printDiagnosticsReport(report, "🩺 Prompt Vault Doctor Report");

      if (report.issues.some((issue) => issue.type === "error")) {
        process.exitCode = 1;
      }
    });
  });

program
  .command("stats")
  .description("Display library statistics and analytics")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, async (service) => {
      const stats = await service.getLibraryStats();

      console.log(chalk.bold("\n📈 Library Statistics\n"));

      console.log(chalk.blue("Prompts:"));
      console.log(`  Total: ${stats.prompts.total}`);
      console.log(`  Active: ${stats.prompts.active}`);
      console.log(`  Deleted: ${stats.prompts.deleted}`);
      console.log(`  By Format:`, stats.prompts.byFormat);

      console.log(chalk.blue("\nTags:"));
      console.log(`  Total: ${stats.tags.total}`);
      console.log(
        `  Average per Prompt: ${stats.tags.averagePerPrompt.toFixed(1)}`,
      );
      console.log(`  Most Used:`);
      for (const tag of stats.tags.mostUsed) {
        console.log(`    ${tag.label}: ${tag.count}`);
      }

      console.log(chalk.blue("\nVersions:"));
      console.log(`  Total: ${stats.versions.total}`);
      console.log(
        `  Average per Prompt: ${stats.versions.averagePerPrompt.toFixed(1)}`,
      );

      console.log(chalk.blue("\nActivity (Last 7 days):"));
      console.log(`  Created: ${stats.activity.createdThisWeek}`);
      console.log(`  Updated: ${stats.activity.updatedThisWeek}`);
      console.log(`  Deleted: ${stats.activity.deletedThisWeek}`);
    });
  });

program
  .command("repair")
  .description("Repair common data integrity issues")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, async (service) => {
      const result = await service.repairIntegrity();

      console.log(chalk.bold("\n🔧 Integrity Repair Report\n"));

      if (result.repairs.length > 0) {
        console.log(chalk.green("Repairs Performed:"));
        for (const repair of result.repairs) {
          console.log(`  ✅ ${repair.description} (${repair.count} items)`);
        }
      } else {
        console.log(chalk.green("✅ No repairs needed!"));
      }

      if (result.errors.length > 0) {
        console.log(chalk.red("\n❌ Repair Errors:"));
        for (const error of result.errors) {
          console.log(`  ${error.message}`);
          if (error.details) {
            console.log(`    Details: ${error.details}`);
          }
        }
      }
    });
  });

program
  .command("plugins")
  .description("Manage plugins and connectors")
  .addCommand(
    new Command("list")
      .description("List all registered plugins and connectors")
      .option("--db <path>", "Path to SQLite database", defaultDbPath)
      .action(async (options) => {
        await useService(options.db, (service) => {
          const host = service.getPluginHost();

          console.log(chalk.bold("\n🔌 Registered Plugins\n"));

          const plugins = host.getPlugins();
          if (plugins.length === 0) {
            console.log(chalk.yellow("No plugins registered."));
          } else {
            for (const plugin of plugins) {
              console.log(
                chalk.cyan(`- ${plugin.name} v${plugin.version ?? "1.0.0"}`),
              );
              if (plugin.description) {
                console.log(chalk.gray(`  ${plugin.description}`));
              }
              if (plugin.connectors && plugin.connectors.length > 0) {
                console.log(
                  chalk.gray(
                    `  Connectors: ${plugin.connectors.map((c: { name: string }) => c.name).join(", ")}`,
                  ),
                );
              }
            }
          }

          console.log(chalk.bold("\n🔗 Registered Connectors\n"));

          const connectors = host.getConnectors();
          if (connectors.length === 0) {
            console.log(chalk.yellow("No connectors registered."));
          } else {
            for (const connector of connectors) {
              console.log(
                chalk.magenta(`- ${connector.name} (${connector.type})`),
              );
            }
          }
        });
      }),
  )
  .addCommand(
    new Command("discover")
      .description("Discover external plugins in specified directories")
      .requiredOption(
        "--dirs <dirs>",
        "Comma-separated list of directories to scan",
      )
      .action(async (options) => {
        const { PluginLoader } = await import("../extensions/index.js");
        const dirs = (options.dirs as string).split(",").map((d) => d.trim());

        const loader = new PluginLoader({
          pluginDirs: dirs,
          logger: logger.child({ component: "plugin-discovery" }),
        });

        console.log(chalk.bold("\n🔍 Plugin Discovery Results\n"));

        const plugins = loader.discoverPlugins();
        if (plugins.length === 0) {
          console.log(
            chalk.yellow("No plugins found in specified directories."),
          );
        } else {
          console.log(chalk.green(`Found ${plugins.length} plugin(s):`));
          for (const plugin of plugins) {
            console.log(chalk.cyan(`- ${plugin.name} v${plugin.version}`));
            console.log(chalk.gray(`  Path: ${plugin.path}`));
            if (plugin.description) {
              console.log(chalk.gray(`  Description: ${plugin.description}`));
            }
          }
        }
      }),
  );

program
  .command("lint")
  .description("Validate prompt files against schema")
  .requiredOption("--file <path>", "Path to the prompt file to validate")
  .option(
    "--format <format>",
    "File format (markdown, yaml, json) - auto-detected if not specified",
  )
  .action(async (options) => {
    const { promptInputSchema } = await import("../domain/validation.js");
    const fs = await import("fs");
    const path = await import("path");
    const yaml = await import("yaml");

    try {
      const filePath = options.file as string;

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        console.error(chalk.red(`File not found: ${filePath}`));
        process.exit(1);
      }

      // Read file content
      const content = fs.readFileSync(filePath, "utf-8");

      // Auto-detect format if not specified
      let format = options.format as "markdown" | "yaml" | "json" | undefined;
      if (!format) {
        const ext = path.extname(filePath).toLowerCase();
        switch (ext) {
          case ".yaml":
          case ".yml":
            format = "yaml";
            break;
          case ".json":
            format = "json";
            break;
          case ".md":
          default:
            format = "markdown";
            break;
        }
      }

      let promptData: Record<string, unknown> = {};

      // Parse content based on format
      if (format === "json") {
        try {
          promptData = JSON.parse(content);
        } catch (error) {
          console.error(
            chalk.red(
              `Invalid JSON format: ${error instanceof Error ? error.message : error}`,
            ),
          );
          process.exit(1);
        }
      } else if (format === "yaml") {
        try {
          promptData = yaml.parse(content);
        } catch (error) {
          console.error(
            chalk.red(
              `Invalid YAML format: ${error instanceof Error ? error.message : error}`,
            ),
          );
          process.exit(1);
        }
      } else if (format === "markdown") {
        // Parse frontmatter from markdown
        const frontmatterMatch = content.match(
          /^---\n([\s\S]*?)\n---\n([\s\S]*)$/,
        );
        if (frontmatterMatch) {
          try {
            const frontmatter = yaml.parse(frontmatterMatch[1]);
            promptData = {
              ...frontmatter,
              body: frontmatterMatch[2].trim(),
            };
          } catch (error) {
            console.error(
              chalk.red(
                `Invalid frontmatter in markdown: ${error instanceof Error ? error.message : error}`,
              ),
            );
            process.exit(1);
          }
        } else {
          // No frontmatter, treat as plain markdown content
          promptData = {
            body: content.trim(),
            format: "markdown",
          };
        }
      }

      // Validate against schema
      const result = promptInputSchema.safeParse(promptData);

      if (result.success) {
        console.log(chalk.green(`✅ ${filePath} is valid`));
        console.log(chalk.gray(`Format: ${format}`));
        console.log(chalk.gray(`Title: ${result.data.title}`));
        console.log(chalk.gray(`Slug: ${result.data.slug}`));
        console.log(chalk.gray(`Version: ${result.data.semanticVersion}`));
        if (result.data.tags && result.data.tags.length > 0) {
          console.log(chalk.gray(`Tags: ${result.data.tags.join(", ")}`));
        }
      } else {
        console.log(chalk.red(`❌ ${filePath} has validation errors:`));
        console.log();

        for (const error of result.error.issues) {
          const pathStr = error.path.join(".");
          console.log(chalk.red(`  • ${pathStr}: ${error.message}`));
        }

        console.log();
        console.log(chalk.yellow(`Format detected: ${format}`));
        process.exit(1);
      }
    } catch (error) {
      console.error(
        chalk.red(
          `Lint failed: ${error instanceof Error ? error.message : error}`,
        ),
      );
      process.exit(1);
    }
  });

program
  .command("sync")
  .description("Manage Git synchronization for prompt libraries")
  .addCommand(
    new Command("init")
      .description("Initialize Git sync for a prompt library")
      .requiredOption("--repo <path>", "Path to the sync repository directory")
      .option("--remote <url>", "Remote Git repository URL")
      .option("--db <path>", "Path to SQLite database", defaultDbPath)
      .action(async (options) => {
        await useService(options.db, async (service) => {
          const { SyncService } = await import("../services/SyncService.js");

          const syncService = new SyncService(service, {
            repoPath: options.repo,
          });

          await syncService.initialize(options.remote);

          console.log(chalk.green(`Git sync initialized at ${options.repo}`));
          if (options.remote) {
            console.log(chalk.gray(`Remote repository: ${options.remote}`));
          }
        });
      }),
  )
  .addCommand(
    new Command("push")
      .description("Push local changes to remote repository")
      .requiredOption("--repo <path>", "Path to the sync repository directory")
      .option(
        "--message <msg>",
        "Commit message",
        `Sync: ${new Date().toISOString()}`,
      )
      .option("--db <path>", "Path to SQLite database", defaultDbPath)
      .action(async (options) => {
        await useService(options.db, async (service) => {
          const { SyncService } = await import("../services/SyncService.js");

          const syncService = new SyncService(service, {
            repoPath: options.repo,
          });

          await syncService.push(options.message);

          console.log(chalk.green(`Changes pushed to remote repository`));
        });
      }),
  )
  .addCommand(
    new Command("pull")
      .description("Pull latest changes from remote repository")
      .requiredOption("--repo <path>", "Path to the sync repository directory")
      .option("--db <path>", "Path to SQLite database", defaultDbPath)
      .action(async (options) => {
        await useService(options.db, async (service) => {
          const { SyncService } = await import("../services/SyncService.js");

          const syncService = new SyncService(service, {
            repoPath: options.repo,
          });

          await syncService.pull();

          console.log(chalk.green(`Changes pulled from remote repository`));
        });
      }),
  )
  .addCommand(
    new Command("status")
      .description("Check sync status and pending changes")
      .requiredOption("--repo <path>", "Path to the sync repository directory")
      .option("--db <path>", "Path to SQLite database", defaultDbPath)
      .action(async (options) => {
        await useService(options.db, async (service) => {
          const { SyncService } = await import("../services/SyncService.js");

          const syncService = new SyncService(service, {
            repoPath: options.repo,
          });

          const status = await syncService.getStatus();

          console.log(chalk.bold("\n🔄 Sync Status\n"));

          if (status.lastSync) {
            console.log(
              chalk.blue(`Last sync: ${status.lastSync.toISOString()}`),
            );
          } else {
            console.log(chalk.yellow(`No sync history found`));
          }

          if (status.hasChanges) {
            console.log(chalk.yellow(`⚠️  Local changes pending`));
          } else {
            console.log(chalk.green(`✅ No local changes`));
          }

          if (status.remoteAhead) {
            console.log(chalk.yellow(`⬇️  Remote has newer changes`));
          }

          if (status.localAhead) {
            console.log(chalk.yellow(`⬆️  Local has unpushed changes`));
          }

          if (status.conflicts.length > 0) {
            console.log(chalk.red(`❌ Conflicts detected:`));
            for (const conflict of status.conflicts) {
              console.log(`  ${conflict}`);
            }
          }
        });
      }),
  );

// Parse command line arguments
program.parse();
