import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { PromptVaultService } from "../services/PromptVaultService.js";
import { bootstrapObservabilityFromEnv } from "../observability/index.js";
import {
  createAuditTrailPlugin,
  createOperationalTelemetryPlugin,
} from "../extensions/index.js";
import type { Prompt, PromptFormat } from "../domain/models.js";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import yaml from "yaml";
import { createLogger } from "../lib/platform-core.js";

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const defaultDbPath = resolve(__dirname, "..", "..", "prompt-vault.db");
const bootstrapLogger = createLogger({
  context: { app: "prompt-vault", module: "mcp-server" },
});

interface SearchMatch {
  line: number;
  column: number;
  preview: string;
  highlightStart: number;
  highlightLength: number;
}

interface SearchResult {
  prompt: {
    id: string;
    name: string;
    tags: string[];
    format: string;
  };
  totalMatches: number;
  matches: SearchMatch[];
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface MCPManifest {
  tools: MCPTool[];
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .substring(0, 50)
    .replace(/^-+|-+$/g, "");
}

function normalizeFormat(format: string | undefined): PromptFormat {
  if (!format || format === "md") return "markdown";
  if (format === "markdown" || format === "json" || format === "yaml")
    return format;
  return "markdown";
}

function mapPromptToMcp(prompt: Prompt): {
  id: string;
  name: string;
  content: string;
  tags: string[];
  format: PromptFormat;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: prompt.id,
    name: prompt.title,
    content: prompt.latestVersion?.body ?? "",
    tags: prompt.tags.map((t) => t.label),
    format: prompt.latestVersion?.format ?? "markdown",
    createdAt: prompt.createdAt.toISOString(),
    updatedAt: prompt.updatedAt.toISOString(),
  };
}

class PromptVaultMCPServer {
  private server: Server;
  private promptService: PromptVaultService;
  private database: Database.Database;
  private observability: ReturnType<typeof bootstrapObservabilityFromEnv>;

  constructor(dbPath?: string) {
    const dbPathToUse = dbPath || defaultDbPath;

    // Initialize observability
    this.observability = bootstrapObservabilityFromEnv({
      serviceName: "prompt-vault-mcp",
    });

    // Initialize database
    this.database = new Database(dbPathToUse);

    // Initialize service
    this.promptService = new PromptVaultService(this.database, {
      telemetry: this.observability.telemetry,
      logger: this.observability.logger.child({ component: "mcp-service" }),
      plugins: [createAuditTrailPlugin(), createOperationalTelemetryPlugin()],
    });

    this.server = new Server(
      {
        name: "prompt-vault-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const mcpManifest = await fs.readFile(
        path.join(process.cwd(), "src", "mcp", "mcp.json"),
        "utf-8",
      );
      const manifest: MCPManifest = JSON.parse(mcpManifest);

      return {
        tools: manifest.tools.map((tool: MCPTool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args = {} } = request.params;

      try {
        switch (name) {
          case "listPrompts":
            return await this.handleListPrompts(
              args as Record<string, unknown>,
            );
          case "readPrompt":
            return await this.handleReadPrompt(args as { id: string });
          case "writePrompt":
            return await this.handleWritePrompt(
              args as {
                id?: string;
                name: string;
                content: string;
                tags?: string[];
                format?: string;
              },
            );
          case "duplicatePrompt":
            return await this.handleDuplicatePrompt(
              args as {
                sourceId: string;
                name?: string;
                content?: string;
                tags?: string[];
              },
            );
          case "searchPrompts":
            return await this.handleSearchPrompts(
              args as {
                query: string;
                caseSensitive?: boolean;
                maxResults?: number;
                maxMatchesPerPrompt?: number;
                maxTotalMatches?: number;
                tags?: string[];
                formats?: string[];
              },
            );
          case "importPrompts":
            return await this.handleImportPrompts(
              args as {
                files: Array<{
                  path: string;
                  name?: string;
                  tags?: string[];
                }>;
              },
            );
          case "exportPrompt":
            return await this.handleExportPrompt(
              args as {
                id: string;
                path: string;
                format?: string;
              },
            );
          case "openInVSCode":
            return await this.handleOpenInVSCode(args as { id: string });
          case "convertPrompt":
            return await this.handleConvertPrompt(
              args as {
                id: string;
                to: "md" | "yaml" | "json";
                createNew?: boolean;
              },
            );
          case "deletePrompt":
            return await this.handleDeletePrompt(args as { id: string });
          case "listTrash":
            return await this.handleListTrash();
          case "restoreTrash":
            return await this.handleRestoreTrash(args as { id: string });
          case "restoreLatestTrash":
            return await this.handleRestoreLatestTrash();
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        this.observability.logger.error(
          `Tool execution failed: ${name}`,
          error,
        );
        throw error;
      }
    });
  }

  private async handleListPrompts(args: Record<string, unknown>): Promise<{
    prompts: Array<{
      id: string;
      name: string;
      content: string;
      tags: string[];
      format: string;
      createdAt: string;
      updatedAt: string;
    }>;
    total: number;
  }> {
    const { tags, formats, limit = 50, offset = 0 } = args;

    const searchResult = await this.promptService.searchPrompts({
      text: "",
      tags: tags || [],
      formats: formats || [],
      page: Math.floor(offset / limit),
      pageSize: limit,
    });

    return {
      prompts: searchResult.prompts.map((p) => mapPromptToMcp(p)),
      total: searchResult.total,
    };
  }

  private async handleReadPrompt(args: { id: string }): Promise<{
    prompt: {
      id: string;
      name: string;
      content: string;
      tags: string[];
      format: string;
      createdAt: string;
      updatedAt: string;
    };
  }> {
    const { id } = args;

    const prompt = await this.promptService.getPrompt(id);
    if (!prompt) {
      throw new Error(`Prompt not found: ${id}`);
    }

    return {
      prompt: mapPromptToMcp(prompt),
    };
  }

  private async handleWritePrompt(args: {
    id?: string;
    name: string;
    content: string;
    tags?: string[];
    format?: string;
  }): Promise<{
    prompt: {
      id: string;
      name: string;
      tags: string[];
      format: string;
      createdAt: string;
      updatedAt: string;
    };
  }> {
    const { id, name, content, tags = [], format = "markdown" } = args;

    let prompt: Prompt;

    if (id) {
      const current = await this.promptService.getPrompt(id);
      if (!current) {
        throw new Error(`Prompt not found: ${id}`);
      }
      this.promptService.addVersion(
        id,
        content,
        current.latestVersion?.semanticVersion ?? "1.0.0",
        normalizeFormat(format),
        "Updated via MCP",
      );
      prompt = await this.promptService.getPrompt(id);
    } else {
      prompt = await this.promptService.createPrompt({
        id: randomUUID(),
        slug: toSlug(name),
        title: name,
        description: "",
        body: content,
        format: normalizeFormat(format),
        semanticVersion: "1.0.0",
        tags,
        changelog: "Created via MCP",
      });
    }

    return {
      prompt: {
        id: prompt.id,
        name: prompt.title,
        tags: prompt.tags.map((t) => t.label),
        format: prompt.latestVersion?.format || "markdown",
        createdAt: prompt.createdAt.toISOString(),
        updatedAt: prompt.updatedAt.toISOString(),
      },
    };
  }

  private async handleDuplicatePrompt(args: {
    sourceId: string;
    name?: string;
    content?: string;
    tags?: string[];
  }): Promise<{
    prompt: {
      id: string;
      name: string;
      tags: string[];
      format: string;
      createdAt: string;
      updatedAt: string;
    };
  }> {
    const { sourceId, name, content, tags } = args;

    const sourcePrompt = await this.promptService.getPrompt(sourceId);
    if (!sourcePrompt) {
      throw new Error(`Source prompt not found: ${sourceId}`);
    }

    const duplicateData = {
      id: randomUUID(),
      slug: toSlug(name || `${sourcePrompt.title}-copy`),
      title: name || `${sourcePrompt.title} (Copy)`,
      description: sourcePrompt.description ?? "",
      body: content || sourcePrompt.latestVersion?.body || "",
      format: sourcePrompt.latestVersion?.format ?? "markdown",
      semanticVersion: sourcePrompt.latestVersion?.semanticVersion ?? "1.0.0",
      tags: tags || sourcePrompt.tags.map((t) => t.label),
      changelog: "Duplicated via MCP",
    };

    const prompt = await this.promptService.createPrompt(duplicateData);

    return {
      prompt: mapPromptToMcp(prompt),
    };
  }

  private async handleSearchPrompts(args: {
    query: string;
    caseSensitive?: boolean;
    maxResults?: number;
    maxMatchesPerPrompt?: number;
    maxTotalMatches?: number;
    tags?: string[];
    formats?: string[];
  }): Promise<{ results: SearchResult[] }> {
    const {
      query,
      caseSensitive = false,
      maxResults = 20,
      maxMatchesPerPrompt = 10,
      maxMatchesPerRule = 3,
      maxTotalMatches = 100,
      tags,
      formats,
    } = args;

    const searchResults = await this.promptService.searchPrompts({
      text: query,
      tags: tags || [],
      formats: formats || [],
      caseSensitive,
      page: 0,
      pageSize: maxResults,
      maxResults,
      maxMatchesPerRule,
      maxTotalMatches,
    });

    const results: SearchResult[] = [];

    for (const prompt of searchResults.prompts) {
      const contentText = prompt.latestVersion?.body ?? "";
      const matches = this.findMatchesInContent(
        contentText,
        query,
        caseSensitive,
        maxMatchesPerPrompt,
      );

      if (matches.length > 0) {
        results.push({
          prompt: {
            id: prompt.id,
            name: prompt.title,
            tags: prompt.tags.map((t) => t.label),
            format: prompt.latestVersion?.format ?? "markdown",
          },
          totalMatches: matches.length,
          matches,
        });

        if (results.length >= maxResults) break;
      }
    }

    return { results };
  }

  private findMatchesInContent(
    content: string,
    query: string,
    caseSensitive: boolean,
    maxMatches: number,
  ): SearchMatch[] {
    const lines = content.split("\n");
    const matches: SearchMatch[] = [];
    const flags = caseSensitive ? "g" : "gi";
    const regex = new RegExp(query, flags);

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      let match;

      while (
        (match = regex.exec(line)) !== null &&
        matches.length < maxMatches
      ) {
        const previewStart = Math.max(0, match.index - 20);
        const previewEnd = Math.min(
          line.length,
          match.index + query.length + 20,
        );
        const preview = line.substring(previewStart, previewEnd);

        matches.push({
          line: lineIndex + 1,
          column: match.index + 1,
          preview,
          highlightStart: match.index - previewStart,
          highlightLength: query.length,
        });
      }
    }

    return matches;
  }

  private async handleImportPrompts(args: {
    files: Array<{
      path: string;
      name?: string;
      tags?: string[];
    }>;
  }): Promise<{
    imported: Array<{
      id: string;
      name: string;
      path: string;
      success: boolean;
      error?: string;
    }>;
  }> {
    const { files } = args;
    const results = [];

    for (const file of files) {
      try {
        const content = await fs.readFile(file.path, "utf-8");
        const format = this.detectFormat(file.path);
        const normalizedFormat = format === "other" ? "markdown" : format;
        const name =
          file.name || path.basename(file.path, path.extname(file.path));

        const prompt = await this.promptService.createPrompt({
          id: randomUUID(),
          slug: toSlug(name),
          title: name,
          description: `Imported from ${file.path}`,
          body: content,
          format: normalizedFormat,
          semanticVersion: "1.0.0",
          tags: file.tags || [],
          changelog: "Imported via MCP",
        });

        results.push({
          id: prompt.id,
          name: prompt.title,
          path: file.path,
          success: true,
        });
      } catch (error) {
        results.push({
          id: "",
          name: file.name || path.basename(file.path),
          path: file.path,
          success: false,
          error: (error as Error).message,
        });
      }
    }

    return { imported: results };
  }

  private async handleExportPrompt(args: {
    id: string;
    path: string;
    format?: string;
  }): Promise<{
    path: string | null;
    success: boolean;
    error?: string;
  }> {
    const { id, path: exportPath, format } = args;

    try {
      const prompt = await this.promptService.getPrompt(id);
      if (!prompt) {
        throw new Error(`Prompt not found: ${id}`);
      }

      const currentFormat = prompt.latestVersion?.format ?? "markdown";
      let content = prompt.latestVersion?.body ?? "";
      if (format && format !== currentFormat) {
        content = this.convertContent(content, currentFormat, format);
      }

      await fs.writeFile(exportPath, content, "utf-8");

      return {
        path: exportPath,
        success: true,
      };
    } catch (error) {
      return {
        path: null,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  private async handleOpenInVSCode(args: { id: string }): Promise<{
    success: boolean;
    error?: string;
  }> {
    const { id } = args;

    try {
      const prompt = await this.promptService.getPrompt(id);
      if (!prompt) {
        throw new Error(`Prompt not found: ${id}`);
      }

      const latestFormat = prompt.latestVersion?.format ?? "markdown";
      const latestBody = prompt.latestVersion?.body ?? "";

      const tempDir = path.join(process.cwd(), "temp");
      await fs.mkdir(tempDir, { recursive: true });

      const tempFile = path.join(
        tempDir,
        `${prompt.id}.${this.getExtension(latestFormat)}`,
      );
      await fs.writeFile(tempFile, latestBody, "utf-8");

      // Open in VS Code
      await execAsync(`code "${tempFile}"`);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  private async handleConvertPrompt(args: {
    id: string;
    to: "md" | "yaml" | "json";
    createNew?: boolean;
  }): Promise<{
    prompt: {
      id: string;
      name: string;
      format: string;
      createdAt: string;
      updatedAt: string;
    };
    converted: boolean;
  }> {
    const { id, to, createNew = true } = args;

    const prompt = await this.promptService.getPrompt(id);
    if (!prompt) {
      throw new Error(`Prompt not found: ${id}`);
    }

    const currentFormat = prompt.latestVersion?.format ?? "markdown";
    const currentBody = prompt.latestVersion?.body ?? "";
    const convertedContent = this.convertContent(
      currentBody,
      currentFormat,
      to,
    );

    let resultPrompt: Prompt;

    if (createNew) {
      resultPrompt = await this.promptService.createPrompt({
        id: randomUUID(),
        slug: toSlug(`${prompt.title}-${to}`),
        title: `${prompt.title} (${to.toUpperCase()})`,
        description: prompt.description,
        body: convertedContent,
        format: normalizeFormat(to),
        semanticVersion: prompt.latestVersion?.semanticVersion ?? "1.0.0",
        tags: prompt.tags.map((t) => t.label),
        changelog: `Converted to ${to}`,
      });
    } else {
      this.promptService.addVersion(
        id,
        convertedContent,
        prompt.latestVersion?.semanticVersion ?? "1.0.0",
        normalizeFormat(to),
        `Converted to ${to}`,
      );
      resultPrompt = await this.promptService.getPrompt(id);
    }

    return {
      prompt: mapPromptToMcp(resultPrompt),
      converted: true,
    };
  }

  private async handleDeletePrompt(args: { id: string }): Promise<{
    success: boolean;
    error?: string;
  }> {
    const { id } = args;

    try {
      await this.promptService.softDeletePrompt(id);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  private async handleListTrash(): Promise<{
    items: Array<{
      id: string;
      name: string;
      deletedAt: string;
    }>;
  }> {
    const deletedPrompts = await this.promptService.getDeletedPrompts();

    return {
      items: deletedPrompts.map((p) => ({
        id: p.id,
        name: p.title,
        deletedAt: p.deletedAt!.toISOString(),
      })),
    };
  }

  private async handleRestoreTrash(args: { id: string }): Promise<{
    success: boolean;
    prompt?: {
      id: string;
      name: string;
    };
    error?: string;
  }> {
    const { id } = args;

    try {
      const prompt = await this.promptService.restorePrompt(id);
      return {
        success: true,
        prompt: {
          id: prompt.id,
          name: prompt.title,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  private async handleRestoreLatestTrash(): Promise<{
    success: boolean;
    prompt?: {
      id: string;
      name: string;
    };
    error?: string;
  }> {
    try {
      const deletedPrompts = await this.promptService.getDeletedPrompts();
      if (deletedPrompts.length === 0) {
        throw new Error("No deleted prompts found");
      }

      const latestDeleted = deletedPrompts.sort(
        (a, b) => b.deletedAt!.getTime() - a.deletedAt!.getTime(),
      )[0];

      const prompt = await this.promptService.restorePrompt(latestDeleted.id);

      return {
        success: true,
        prompt: {
          id: prompt.id,
          name: prompt.title,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  private detectFormat(filePath: string): PromptFormat | "other" {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case ".md":
        return "markdown";
      case ".yaml":
      case ".yml":
        return "yaml";
      case ".json":
        return "json";
      default:
        return "other";
    }
  }

  private getExtension(format: string): string {
    switch (format) {
      case "md":
      case "markdown":
        return "md";
      case "yaml":
        return "yaml";
      case "json":
        return "json";
      default:
        return "txt";
    }
  }

  private convertContent(content: string, from: string, to: string): string {
    const normalizedFrom = from === "markdown" ? "md" : from;
    const normalizedTo = to === "markdown" ? "md" : to;

    // Parse content based on source format
    let data: unknown;

    switch (normalizedFrom) {
      case "json":
        data = JSON.parse(content);
        break;
      case "yaml":
        data = yaml.parse(content);
        break;
      case "md":
        // For markdown, we'll treat it as plain text for now
        // Could be enhanced to parse frontmatter
        data = { content };
        break;
      default:
        data = { content };
    }

    // Convert to target format
    switch (normalizedTo) {
      case "json":
        return JSON.stringify(data, null, 2);
      case "yaml":
        return yaml.stringify(data);
      case "md":
        if (
          typeof data === "object" &&
          data !== null &&
          "content" in data &&
          typeof (data as { content: unknown }).content === "string"
        ) {
          return (data as { content: string }).content;
        }
        return content;
      default:
        return content;
    }
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.observability.logger.info("Prompt Vault MCP Server started");
  }
}

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new PromptVaultMCPServer();
  server.start().catch((error) => {
    bootstrapLogger.error("Failed to start MCP server", { error });
    process.exit(1);
  });
}

export { PromptVaultMCPServer };
