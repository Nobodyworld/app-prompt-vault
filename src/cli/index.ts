#!/usr/bin/env node
import { Command } from "commander";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import chalk from "chalk";
import { randomUUID } from "node:crypto";
import { PromptVaultService } from "../services/PromptVaultService.js";

const program = new Command();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const defaultDbPath = resolve(__dirname, "..", "..", "prompt-vault.db");

/**
 * Helper to create a PromptVaultService, run the provided handler, and ensure the database connection closes.
 * @param dbPath - Path to the SQLite database file.
 * @param handler - Callback invoked with the service instance.
 */
async function useService(dbPath: string, handler: (service: PromptVaultService) => Promise<void> | void): Promise<void> {
  const database = new Database(dbPath);
  const service = new PromptVaultService(database);
  try {
    await handler(service);
  } finally {
    database.close();
  }
}

program
  .name("prompt-vault")
  .description("Manage your reusable prompt library from the command line.")
  .version("0.1.0");

program
  .command("create")
  .description("Create a new prompt with an initial version")
  .requiredOption("--slug <slug>", "Unique slug for the prompt")
  .requiredOption("--title <title>", "Title for the prompt")
  .requiredOption("--body <body>", "Prompt body text")
  .option("--version <version>", "Semantic version", "1.0.0")
  .option("--description <description>", "Optional description")
  .option("--tags <tags>", "Comma separated tag labels", "")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, (service) => {
      const tags = options.tags
        ? (options.tags as string)
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : [];

      const prompt = service.createPrompt({
        id: randomUUID(),
        slug: options.slug,
        title: options.title,
        description: options.description,
        body: options.body,
        semanticVersion: options.version,
        tags,
        changelog: undefined,
      });

      console.log(chalk.green(`Created prompt ${prompt.title} (${prompt.slug})`));
    });
  });

program
  .command("list")
  .description("List prompts with optional filters")
  .option("--text <text>", "Search text")
  .option("--tags <tags>", "Comma separated tag filters")
  .option("--page <page>", "Page number", "0")
  .option("--page-size <size>", "Page size", "10")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, (service) => {
      const tags = options.tags
        ? (options.tags as string)
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : undefined;
      const result = service.searchPrompts({
        text: options.text,
        tags,
        page: Number.parseInt(options.page as string, 10),
        pageSize: Number.parseInt(options.pageSize as string, 10),
      });

      if (result.prompts.length === 0) {
        console.log(chalk.yellow("No prompts found."));
        return;
      }

      for (const prompt of result.prompts) {
        console.log(chalk.cyan(`- ${prompt.title} (${prompt.slug})`));
        if (prompt.latestVersion) {
          console.log(
            chalk.gray(
              `  latest v${prompt.latestVersion.semanticVersion} updated ${prompt.latestVersion.updatedAt.toISOString()}`
            )
          );
        }
        if (prompt.tags.length > 0) {
          console.log(chalk.magenta(`  tags: ${prompt.tags.map((tag) => tag.label).join(", ")}`));
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
    await useService(options.db, (service) => {
      const labels = (options.tags as string)
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      service.tagPrompt(options.id, labels);
      console.log(chalk.green(`Tagged prompt ${options.id} with ${labels.join(", ")}`));
    });
  });

program
  .command("version")
  .description("Add a new version to a prompt")
  .requiredOption("--id <id>", "Prompt identifier")
  .requiredOption("--body <body>", "Prompt body text")
  .option("--version <version>", "Semantic version", "1.0.0")
  .option("--changelog <changelog>", "Changelog text")
  .option("--db <path>", "Path to SQLite database", defaultDbPath)
  .action(async (options) => {
    await useService(options.db, (service) => {
      const version = service.addVersion(options.id, options.body, options.version, options.changelog);
      console.log(chalk.green(`Added version ${version.semanticVersion} to prompt ${options.id}`));
    });
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(chalk.red(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
