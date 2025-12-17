import path from "path";
import fs from "fs/promises";
import type { PromptVaultService } from "./PromptVaultService.js";
import { GitService, type GitConfig } from "./GitService.js";
import type { Prompt, PromptFormat } from "../domain/models.js";

export interface SyncConfig {
  repoPath: string;
  gitConfig?: GitConfig;
}

export interface SyncStatus {
  lastSync: Date | null;
  hasChanges: boolean;
  remoteAhead: boolean;
  localAhead: boolean;
  conflicts: string[];
}

interface ParsedPrompt {
  id: string;
  slug: string;
  title: string;
  description: string;
  body: string;
  format: PromptFormat;
  semanticVersion: string;
  tags: string[];
}

export class SyncService {
  private vaultService: PromptVaultService;
  private gitService: GitService;
  private repoPath: string;
  private promptsDir: string;

  constructor(vaultService: PromptVaultService, config: SyncConfig) {
    this.vaultService = vaultService;
    this.repoPath = config.repoPath;
    this.promptsDir = path.join(this.repoPath, "prompts");
    this.gitService = new GitService(this.repoPath, config.gitConfig);
  }

  /**
   * Initialize sync repository
   */
  async initialize(remoteUrl?: string): Promise<void> {
    // Ensure repo directory exists
    await fs.mkdir(this.repoPath, { recursive: true });

    // Initialize Git repository
    await this.gitService.init();

    // Add remote if provided
    if (remoteUrl) {
      await this.gitService.addRemote("origin", remoteUrl);
    }

    // Create prompts directory
    await fs.mkdir(this.promptsDir, { recursive: true });
  }

  /**
   * Export prompts from database to file system
   */
  async export(): Promise<void> {
    const searchResult = await this.vaultService.searchPrompts({
      text: "",
      tags: [],
      page: 0,
      pageSize: 1000, // Get all prompts
    });

    // Clear existing files
    await this.clearPromptsDir();

    // Export each prompt
    for (const prompt of searchResult.prompts) {
      const filePath = this.getPromptFilePath(prompt);
      const content = this.formatPromptForFile(prompt);
      await fs.writeFile(filePath, content, "utf-8");
    }
  }

  /**
   * Import prompts from file system to database
   */
  async import(): Promise<void> {
    const files = await this.getPromptFiles();

    for (const file of files) {
      const content = await fs.readFile(file, "utf-8");
      const prompt = this.parsePromptFromFile(content);

      // Check if prompt exists
      try {
        const existing = await this.vaultService.getPrompt(prompt.id);
        if (existing) {
          // Update existing prompt by adding a new version
          this.vaultService.addVersion(
            existing.id,
            prompt.body,
            prompt.semanticVersion,
            prompt.format,
          );
        }
      } catch {
        // Prompt doesn't exist, create new one
        await this.vaultService.createPrompt({
          id: prompt.id,
          slug: prompt.slug,
          title: prompt.title,
          description: prompt.description,
          body: prompt.body,
          format: prompt.format,
          semanticVersion: prompt.semanticVersion,
          tags: prompt.tags,
        });
      }
    }
  }

  /**
   * Push changes to remote repository
   */
  async push(message?: string): Promise<void> {
    // Export current state
    await this.export();

    // Add and commit changes
    await this.gitService.add();
    const status = await this.gitService.status();

    if (!status.isClean) {
      const commitMessage = message || `Sync: ${new Date().toISOString()}`;
      await this.gitService.commit(commitMessage);
    }

    // Push to remote
    await this.gitService.push();
  }

  /**
   * Pull changes from remote repository
   */
  async pull(): Promise<void> {
    // Pull from remote
    await this.gitService.pull();

    // Import changes
    await this.import();
  }

  /**
   * Get sync status
   */
  async getStatus(): Promise<SyncStatus> {
    const gitStatus = await this.gitService.status();
    const hasConflicts = await this.gitService.hasConflicts();

    return {
      lastSync: await this.getLastSyncTime(),
      hasChanges: !gitStatus.isClean,
      remoteAhead: gitStatus.behind > 0,
      localAhead: gitStatus.ahead > 0,
      conflicts: hasConflicts ? ["Merge conflicts detected"] : [],
    };
  }

  /**
   * Check if sync is initialized
   */
  async isInitialized(): Promise<boolean> {
    return await this.gitService.isInitialized();
  }

  private async clearPromptsDir(): Promise<void> {
    try {
      const files = await fs.readdir(this.promptsDir);
      for (const file of files) {
        if (
          file.endsWith(".md") ||
          file.endsWith(".yaml") ||
          file.endsWith(".json")
        ) {
          await fs.unlink(path.join(this.promptsDir, file));
        }
      }
    } catch {
      // Directory doesn't exist or is empty
    }
  }

  private async getPromptFiles(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.promptsDir);
      return files
        .filter(
          (file) =>
            file.endsWith(".md") ||
            file.endsWith(".yaml") ||
            file.endsWith(".json"),
        )
        .map((file) => path.join(this.promptsDir, file));
    } catch {
      return [];
    }
  }

  private getPromptFilePath(prompt: Prompt): string {
    const extension =
      prompt.latestVersion?.format === "markdown"
        ? "md"
        : prompt.latestVersion?.format || "md";
    return path.join(this.promptsDir, `${prompt.slug}.${extension}`);
  }

  private formatPromptForFile(prompt: Prompt): string {
    const frontmatter = {
      id: prompt.id,
      slug: prompt.slug,
      title: prompt.title,
      description: prompt.description || "",
      format: prompt.latestVersion?.format || "markdown",
      version: prompt.latestVersion?.semanticVersion || "1.0.0",
      tags: prompt.tags?.map((t) => t.label) || [],
      created: prompt.createdAt.toISOString(),
      updated: prompt.updatedAt.toISOString(),
    };

    const yamlFrontmatter = `---
${Object.entries(frontmatter)
  .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
  .join("\n")}
---

`;

    return yamlFrontmatter + (prompt.latestVersion?.body || "");
  }

  private parsePromptFromFile(content: string): ParsedPrompt {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) {
      throw new Error("Invalid prompt file format");
    }

    const frontmatter = frontmatterMatch[1];
    const body = frontmatterMatch[2];

    // Simple YAML parsing (in production, use a proper YAML parser)
    const metadata: Record<string, unknown> = {};
    const lines = frontmatter.split("\n");
    for (const line of lines) {
      const [key, ...valueParts] = line.split(": ");
      if (key && valueParts.length > 0) {
        const value = valueParts.join(": ");
        try {
          metadata[key] = JSON.parse(value);
        } catch {
          metadata[key] = value;
        }
      }
    }

    return {
      id: String(metadata.id || ""),
      slug: String(metadata.slug || ""),
      title: String(metadata.title || ""),
      description: String(metadata.description || ""),
      body,
      format: (metadata.format as PromptFormat) || "markdown",
      semanticVersion: String(metadata.version || "1.0.0"),
      tags: Array.isArray(metadata.tags) ? metadata.tags.map(String) : [],
    };
  }

  private async getLastSyncTime(): Promise<Date | null> {
    try {
      const log = await this.gitService.log(1);
      if (log.length > 0) {
        return new Date(log[0].date);
      }
    } catch {
      // No commits yet
    }
    return null;
  }
}
