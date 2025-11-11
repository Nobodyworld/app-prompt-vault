import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { PromptVaultService } from '../services/PromptVaultService.js';
import { bootstrapObservabilityFromEnv } from '../observability/index.js';
import { createAuditTrailPlugin, createOperationalTelemetryPlugin } from '../extensions/index.js';
import type { Prompt, PromptFormat } from '../domain/models.js';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import yaml from 'yaml';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const defaultDbPath = resolve(__dirname, '..', '..', 'prompt-vault.db');

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

class PromptVaultMCPServer {
  private server: Server;
  private promptService: PromptVaultService;
  private database: Database.Database;
  private observability: ReturnType<typeof bootstrapObservabilityFromEnv>;

  constructor(dbPath?: string) {
    const dbPathToUse = dbPath || defaultDbPath;

    // Initialize observability
    this.observability = bootstrapObservabilityFromEnv({ serviceName: 'prompt-vault-mcp' });

    // Initialize database
    this.database = new Database(dbPathToUse);

    // Initialize service
    this.promptService = new PromptVaultService(this.database, {
      telemetry: this.observability.telemetry,
      logger: this.observability.logger.child({ component: 'mcp-service' }),
      plugins: [createAuditTrailPlugin(), createOperationalTelemetryPlugin()],
    });

    this.server = new Server(
      {
        name: 'prompt-vault-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const mcpManifest = await fs.readFile(
        path.join(process.cwd(), 'src', 'mcp', 'mcp.json'),
        'utf-8'
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
          case 'listPrompts':
            return await this.handleListPrompts(args as Record<string, unknown>);
          case 'readPrompt':
            return await this.handleReadPrompt(args as { id: string });
          case 'writePrompt':
            return await this.handleWritePrompt(args as {
              id?: string;
              name: string;
              content: string;
              tags?: string[];
              format?: string;
            });
          case 'duplicatePrompt':
            return await this.handleDuplicatePrompt(args as {
              sourceId: string;
              name?: string;
              content?: string;
              tags?: string[];
            });
          case 'searchPrompts':
            return await this.handleSearchPrompts(args as {
              query: string;
              caseSensitive?: boolean;
              maxResults?: number;
              maxMatchesPerPrompt?: number;
              maxTotalMatches?: number;
              tags?: string[];
              formats?: string[];
            });
          case 'importPrompts':
            return await this.handleImportPrompts(args as {
              files: Array<{
                path: string;
                name?: string;
                tags?: string[];
              }>;
            });
          case 'exportPrompt':
            return await this.handleExportPrompt(args as {
              id: string;
              path: string;
              format?: string;
            });
          case 'openInVSCode':
            return await this.handleOpenInVSCode(args as { id: string });
          case 'convertPrompt':
            return await this.handleConvertPrompt(args as {
              id: string;
              to: 'md' | 'yaml' | 'json';
              createNew?: boolean;
            });
          case 'deletePrompt':
            return await this.handleDeletePrompt(args as { id: string });
          case 'listTrash':
            return await this.handleListTrash();
          case 'restoreTrash':
            return await this.handleRestoreTrash(args as { id: string });
          case 'restoreLatestTrash':
            return await this.handleRestoreLatestTrash();
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        this.observability.logger.error(`Tool execution failed: ${name}`, error);
        throw error;
      }
    });
  }

  private async handleListPrompts(args: Record<string, any>): Promise<{
    prompts: Array<{
      id: string;
      name: string;
      tags: string[];
      format: string;
      createdAt: string;
      updatedAt: string;
    }>;
    total: number;
  }> {
    const { tags, formats, limit = 50, offset = 0 } = args;

    const searchResult = this.promptService.searchPrompts({
      text: '',
      tags: tags || [],
      formats: formats || [],
      page: Math.floor(offset / limit),
      pageSize: limit,
    });

    return {
      prompts: searchResult.prompts.map(p => ({
        id: p.id,
        name: p.title,
        tags: Array.from(p.tags.map(t => t.label)),
        format: p.latestVersion?.format || 'markdown',
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
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
      prompt: {
        id: prompt.id,
        name: prompt.title,
        content: prompt.latestVersion?.body ?? '',
        tags: [...prompt.tags.map(tag => tag.label)],
        format: prompt.latestVersion?.format ?? 'markdown',
        createdAt: prompt.createdAt.toISOString(),
        updatedAt: prompt.updatedAt.toISOString(),
      },
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
    const { id, name, content, tags = [], format = 'markdown' } = args;

    let prompt: Prompt;

    if (id) {
      // Update existing prompt by adding a new version
      this.promptService.addVersion(id, content, '1.0.0', format as PromptFormat);
      prompt = this.promptService.getPrompt(id);
    } else {
      // Create new prompt
      prompt = this.promptService.createPrompt({
        id: randomUUID(),
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 50),
        title: name,
        description: '',
        body: content,
        format: format as PromptFormat,
        semanticVersion: '1.0.0',
        tags,
        changelog: 'Created via MCP',
      });
    }

    return {
      prompt: {
        id: prompt.id,
        name: prompt.title,
        tags: prompt.tags.map(t => t.label),
        format: prompt.latestVersion?.format || 'markdown',
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
      name: name || `${sourcePrompt.name} (Copy)`,
      content: content || sourcePrompt.content,
      tags: tags || sourcePrompt.tags,
      format: sourcePrompt.format,
    };

    const prompt = await this.promptService.createPrompt(duplicateData);

    return {
      prompt: {
        id: prompt.id,
        name: prompt.name,
        tags: prompt.tags,
        format: prompt.format,
        createdAt: prompt.createdAt.toISOString(),
        updatedAt: prompt.updatedAt.toISOString(),
      },
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
      tags,
      formats,
    } = args;

    const searchResults = await this.promptService.searchPrompts(query, {
      caseSensitive,
      tags: tags || [],
      formats: formats || [],
      limit: maxResults,
    });

    const results: SearchResult[] = [];

    for (const prompt of searchResults) {
      const matches = this.findMatchesInContent(
        prompt.content,
        query,
        caseSensitive,
        maxMatchesPerPrompt
      );

      if (matches.length > 0) {
        results.push({
          prompt: {
            id: prompt.id,
            name: prompt.name,
            tags: prompt.tags,
            format: prompt.format,
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
    maxMatches: number
  ): SearchMatch[] {
    const lines = content.split('\n');
    const matches: SearchMatch[] = [];
    const flags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(query, flags);

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      let match;

      while ((match = regex.exec(line)) !== null && matches.length < maxMatches) {
        const previewStart = Math.max(0, match.index - 20);
        const previewEnd = Math.min(line.length, match.index + query.length + 20);
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
        const content = await fs.readFile(file.path, 'utf-8');
        const format = this.detectFormat(file.path);
        const name = file.name || path.basename(file.path, path.extname(file.path));

        const prompt = await this.promptService.createPrompt({
          name,
          content,
          tags: file.tags || [],
          format,
        });

        results.push({
          id: prompt.id,
          name: prompt.name,
          path: file.path,
          success: true,
        });
      } catch (error) {
        results.push({
          id: '',
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

      let content = prompt.content;
      if (format && format !== prompt.format) {
        content = this.convertContent(content, prompt.format, format);
      }

      await fs.writeFile(exportPath, content, 'utf-8');

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

      // Create a temporary file for VS Code to open
      const tempDir = path.join(process.cwd(), 'temp');
      await fs.mkdir(tempDir, { recursive: true });

      const tempFile = path.join(tempDir, `${prompt.id}.${this.getExtension(prompt.format)}`);
      await fs.writeFile(tempFile, prompt.content, 'utf-8');

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
    to: 'md' | 'yaml' | 'json';
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

    const convertedContent = this.convertContent(prompt.content, prompt.format, to);

    let resultPrompt: Prompt;

    if (createNew) {
      resultPrompt = await this.promptService.createPrompt({
        name: `${prompt.name} (${to.toUpperCase()})`,
        content: convertedContent,
        tags: prompt.tags,
        format: to,
      });
    } else {
      resultPrompt = await this.promptService.updatePrompt(id, {
        content: convertedContent,
        format: to,
      });
    }

    return {
      prompt: {
        id: resultPrompt.id,
        name: resultPrompt.name,
        format: resultPrompt.format,
        createdAt: resultPrompt.createdAt.toISOString(),
        updatedAt: resultPrompt.updatedAt.toISOString(),
      },
      converted: true,
    };
  }

  private async handleDeletePrompt(args: { id: string }): Promise<{
    success: boolean;
    error?: string;
  }> {
    const { id } = args;

    try {
      await this.promptService.deletePrompt(id);
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
      items: deletedPrompts.map(p => ({
        id: p.id,
        name: p.name,
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
          name: prompt.name,
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
        throw new Error('No deleted prompts found');
      }

      const latestDeleted = deletedPrompts.sort(
        (a, b) => b.deletedAt!.getTime() - a.deletedAt!.getTime()
      )[0];

      const prompt = await this.promptService.restorePrompt(latestDeleted.id);

      return {
        success: true,
        prompt: {
          id: prompt.id,
          name: prompt.name,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  private detectFormat(filePath: string): PromptFormat | 'other' {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.md':
        return 'markdown';
      case '.yaml':
      case '.yml':
        return 'yaml';
      case '.json':
        return 'json';
      default:
        return 'other';
    }
  }

  private getExtension(format: string): string {
    switch (format) {
      case 'md':
        return 'md';
      case 'yaml':
        return 'yaml';
      case 'json':
        return 'json';
      default:
        return 'txt';
    }
  }

  private convertContent(content: string, from: string, to: string): string {
    // Parse content based on source format
    let data: any;

    switch (from) {
      case 'json':
        data = JSON.parse(content);
        break;
      case 'yaml':
        data = yaml.parse(content);
        break;
      case 'md':
        // For markdown, we'll treat it as plain text for now
        // Could be enhanced to parse frontmatter
        data = { content };
        break;
      default:
        data = { content };
    }

    // Convert to target format
    switch (to) {
      case 'json':
        return JSON.stringify(data, null, 2);
      case 'yaml':
        return yaml.stringify(data);
      case 'md':
        if (typeof data === 'object' && data.content) {
          return data.content;
        }
        return content;
      default:
        return content;
    }
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.info('Prompt Vault MCP Server started');
  }
}

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new PromptVaultMCPServer();
  server.start().catch((error) => {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  });
}

export { PromptVaultMCPServer };
