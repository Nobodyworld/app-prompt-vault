import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PromptVaultMCPServer } from "../src/mcp/server.js";
import { resetCoreDb } from "../src/lib/platform-core.js";

interface McpContext {
  readonly directory: string;
  readonly databasePath: string;
  readonly temporaryDirectory: string;
  readonly client: Client;
  readonly server: PromptVaultMCPServer;
  readonly executeCommand: ReturnType<typeof vi.fn>;
  failCommands: boolean;
}

const contexts: McpContext[] = [];
const originalTagDatabasePath = process.env.PROMPT_VAULT_TAG_DB_PATH;

async function createContext(options: {
  manifestPath?: string;
} = {}): Promise<McpContext> {
  const directory = await mkdtemp(join(tmpdir(), "pv-mcp-in-process-"));
  const databasePath = join(directory, "prompt-vault.db");
  const temporaryDirectory = join(directory, "editor-files");
  const context = {
    directory,
    databasePath,
    temporaryDirectory,
    failCommands: false,
  } as McpContext;
  const executeCommand = vi.fn(async (command: string) => {
    if (context.failCommands) {
      throw new Error("editor unavailable");
    }
    return { stdout: command, stderr: "" };
  });
  const server = new PromptVaultMCPServer({
    dbPath: databasePath,
    manifestPath:
      options.manifestPath ?? resolve("src", "mcp", "mcp.json"),
    temporaryDirectory,
    executeCommand,
  });
  const client = new Client(
    { name: "prompt-vault-coverage-client", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  Object.assign(context, { executeCommand, server, client });
  contexts.push(context);
  return context;
}

async function callTool<T>(
  client: Client,
  name: string,
  arguments_: Record<string, unknown> = {},
): Promise<T> {
  const result = (await client.request(
    {
      method: "tools/call",
      params: { name, arguments: arguments_ },
    },
    z.any(),
  )) as Record<string, unknown>;
  if (Array.isArray(result.content) && result.content.length === 0) {
    const { content: _, ...structuredResult } = result;
    return structuredResult as T;
  }
  return result as T;
}

afterEach(async () => {
  const activeContexts = contexts.splice(0);
  await Promise.all(
    activeContexts.map(async (context) => {
      await context.client.close().catch(() => undefined);
      await context.server.close().catch(() => undefined);
    }),
  );
  await resetCoreDb();
  await Promise.all(
    activeContexts.map((context) =>
      rm(context.directory, { recursive: true, force: true }),
    ),
  );
  if (originalTagDatabasePath === undefined) {
    delete process.env.PROMPT_VAULT_TAG_DB_PATH;
  } else {
    process.env.PROMPT_VAULT_TAG_DB_PATH = originalTagDatabasePath;
  }
});

describe("PromptVaultMCPServer in-memory protocol integration", () => {
  let context: McpContext;

  beforeEach(async () => {
    process.env.PROMPT_VAULT_TAG_DB_PATH = ":memory:";
    context = await createContext();
  });

  it("initializes and lists the complete manifest through the supported SDK transport", async () => {
    const result = await context.client.listTools();

    expect(result.tools).toHaveLength(13);
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "listPrompts",
      "readPrompt",
      "writePrompt",
      "duplicatePrompt",
      "searchPrompts",
      "importPrompts",
      "exportPrompt",
      "openInVSCode",
      "convertPrompt",
      "deletePrompt",
      "listTrash",
      "restoreTrash",
      "restoreLatestTrash",
    ]);
    expect(
      result.tools.every(
        (tool) =>
          tool.description.length > 0 &&
          tool.inputSchema.type === "object",
      ),
    ).toBe(true);
  });

  it("dispatches the full prompt, search, file, conversion, and trash workflow", async () => {
    const created = await callTool<{
      prompt: { id: string; name: string; tags: string[]; format: string };
    }>(context.client, "writePrompt", {
      name: "Coverage Source",
      content: "Alpha needle\nSecond Needle occurrence",
      tags: ["mcp", "coverage"],
      format: "md",
    });
    expect(created.prompt).toMatchObject({
      name: "Coverage Source",
      tags: ["coverage", "mcp"],
      format: "markdown",
    });
    expect(created.prompt.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const read = await callTool<{
      prompt: { id: string; content: string };
    }>(context.client, "readPrompt", { id: created.prompt.id });
    expect(read.prompt).toMatchObject({
      id: created.prompt.id,
      content: "Alpha needle\nSecond Needle occurrence",
    });

    const listed = await callTool<{
      prompts: Array<{ id: string }>;
      total: number;
    }>(context.client, "listPrompts", {
      tags: ["mcp"],
      limit: 1,
      offset: 0,
    });
    expect(listed.total).toBe(1);
    expect(listed.prompts).toEqual([
      expect.objectContaining({ id: created.prompt.id }),
    ]);
    const emptyPage = await callTool<{ prompts: unknown[]; total: number }>(
      context.client,
      "listPrompts",
      { limit: 1, offset: 10 },
    );
    expect(emptyPage).toEqual({ prompts: [], total: 1 });

    const search = await callTool<{
      results: Array<{
        prompt: { id: string };
        totalMatches: number;
        matches: Array<{
          line: number;
          column: number;
          highlightLength: number;
        }>;
      }>;
    }>(context.client, "searchPrompts", {
      query: "needle",
      caseSensitive: false,
      maxResults: 5,
      maxMatchesPerPrompt: 1,
      maxTotalMatches: 10,
      tags: ["mcp"],
      formats: ["markdown"],
    });
    expect(search.results).toHaveLength(1);
    expect(search.results[0]).toMatchObject({
      prompt: { id: created.prompt.id },
      totalMatches: 1,
      matches: [{ line: 1, column: 7, highlightLength: 6 }],
    });
    const noMatch = await callTool<{ results: unknown[] }>(
      context.client,
      "searchPrompts",
      {
        query: "NEEDLE",
        caseSensitive: true,
      },
    );
    expect(noMatch.results).toEqual([]);

    const duplicate = await callTool<{
      prompt: { id: string; name: string; content: string; tags: string[] };
    }>(context.client, "duplicatePrompt", {
      sourceId: created.prompt.id,
      name: "Coverage Duplicate",
      content: "Duplicate override",
      tags: ["copy"],
    });
    expect(duplicate.prompt).toMatchObject({
      name: "Coverage Duplicate",
      content: "Duplicate override",
      tags: ["copy"],
    });
    expect(duplicate.prompt.id).not.toBe(created.prompt.id);

    const defaultDuplicate = await callTool<{
      prompt: { name: string; content: string };
    }>(context.client, "duplicatePrompt", {
      sourceId: created.prompt.id,
    });
    expect(defaultDuplicate.prompt).toMatchObject({
      name: "Coverage Source (Copy)",
      content: "Alpha needle\nSecond Needle occurrence",
    });

    const updated = await callTool<{
      prompt: { id: string; name: string };
    }>(context.client, "writePrompt", {
      id: created.prompt.id,
      name: "Name is ignored for version updates",
      content: '{"message":"updated"}',
      format: "json",
    });
    expect(updated.prompt).toMatchObject({
      id: created.prompt.id,
      name: "Coverage Source",
    });
    const updatedRead = await callTool<{
      prompt: { content: string; format: string };
    }>(context.client, "readPrompt", { id: created.prompt.id });
    expect(updatedRead.prompt).toMatchObject({
      content: '{"message":"updated"}',
      format: "json",
    });

    const convertedNew = await callTool<{
      prompt: { id: string; name: string; format: string };
      converted: boolean;
    }>(context.client, "convertPrompt", {
      id: created.prompt.id,
      to: "yaml",
    });
    expect(convertedNew).toMatchObject({
      prompt: { name: "Coverage Source (YAML)", format: "yaml" },
      converted: true,
    });
    expect(convertedNew.prompt.id).not.toBe(created.prompt.id);

    const convertedInPlace = await callTool<{
      prompt: { id: string; format: string };
      converted: boolean;
    }>(context.client, "convertPrompt", {
      id: created.prompt.id,
      to: "md",
      createNew: false,
    });
    expect(convertedInPlace).toMatchObject({
      prompt: { id: created.prompt.id, format: "markdown" },
      converted: true,
    });

    const exportPath = join(context.directory, "exported.yaml");
    const exported = await callTool<{
      path: string | null;
      success: boolean;
    }>(context.client, "exportPrompt", {
      id: created.prompt.id,
      path: exportPath,
      format: "yaml",
    });
    expect(exported).toEqual({ path: exportPath, success: true });
    const exportedContent = await readFile(exportPath, "utf8");
    expect(exportedContent).toContain("content:");
    expect(exportedContent).toContain('"message":"updated"');

    const markdownImportPath = join(context.directory, "import-one.md");
    const jsonImportPath = join(context.directory, "import-two.json");
    const otherImportPath = join(context.directory, "import-three.txt");
    await writeFile(markdownImportPath, "Markdown import");
    await writeFile(jsonImportPath, '{"imported":true}');
    await writeFile(otherImportPath, "Other import");
    const imported = await callTool<{
      imported: Array<{
        id: string;
        name: string;
        path: string;
        success: boolean;
        error?: string;
      }>;
    }>(context.client, "importPrompts", {
      files: [
        {
          path: markdownImportPath,
          name: "Imported Markdown",
          tags: ["imported"],
        },
        { path: jsonImportPath },
        { path: otherImportPath },
        { path: join(context.directory, "missing.md"), name: "Missing" },
      ],
    });
    expect(imported.imported).toHaveLength(4);
    expect(imported.imported.slice(0, 3)).toEqual([
      expect.objectContaining({
        name: "Imported Markdown",
        success: true,
      }),
      expect.objectContaining({ name: "import-two", success: true }),
      expect.objectContaining({ name: "import-three", success: true }),
    ]);
    expect(imported.imported[3]).toMatchObject({
      id: "",
      name: "Missing",
      success: false,
      error: expect.stringContaining("missing.md"),
    });

    const opened = await callTool<{ success: boolean }>(
      context.client,
      "openInVSCode",
      { id: created.prompt.id },
    );
    expect(opened).toEqual({ success: true });
    expect(context.executeCommand).toHaveBeenCalledWith(
      expect.stringContaining(created.prompt.id),
    );
    expect(
      await readFile(
        join(context.temporaryDirectory, `${created.prompt.id}.md`),
        "utf8",
      ),
    ).toContain("message");

    expect(
      await callTool(context.client, "deletePrompt", {
        id: duplicate.prompt.id,
      }),
    ).toEqual({ success: true });
    const trash = await callTool<{
      items: Array<{ id: string; name: string; deletedAt: string }>;
    }>(context.client, "listTrash");
    expect(trash.items).toEqual([
      expect.objectContaining({
        id: duplicate.prompt.id,
        name: "Coverage Duplicate",
      }),
    ]);
    expect(Date.parse(trash.items[0].deletedAt)).not.toBeNaN();

    const restored = await callTool<{
      success: boolean;
      prompt: { id: string; name: string };
    }>(context.client, "restoreTrash", { id: duplicate.prompt.id });
    expect(restored).toEqual({
      success: true,
      prompt: {
        id: duplicate.prompt.id,
        name: "Coverage Duplicate",
      },
    });

    await callTool(context.client, "deletePrompt", {
      id: defaultDuplicate.prompt.id,
    });
    const latest = await callTool<{
      success: boolean;
      prompt: { id: string };
    }>(context.client, "restoreLatestTrash");
    expect(latest).toMatchObject({
      success: true,
      prompt: { id: defaultDuplicate.prompt.id },
    });
  });

  it("returns deliberate tool failures and keeps the server usable afterward", async () => {
    const missingId = randomUUID();

    await expect(
      callTool(context.client, "unknownTool"),
    ).rejects.toThrow("Unknown tool");
    await expect(
      callTool(context.client, "readPrompt", { id: missingId }),
    ).rejects.toThrow(missingId);
    await expect(
      callTool(context.client, "writePrompt", { content: "missing name" }),
    ).rejects.toThrow();
    await expect(
      callTool(context.client, "writePrompt", {
        id: missingId,
        name: "Missing",
        content: "Body",
      }),
    ).rejects.toThrow(missingId);
    await expect(
      callTool(context.client, "duplicatePrompt", { sourceId: missingId }),
    ).rejects.toThrow(missingId);
    const created = await callTool<{
      prompt: { id: string };
    }>(context.client, "writePrompt", {
      name: "Command Failure",
      content: "Body",
    });
    await expect(
      callTool<{ results: unknown[] }>(
        context.client,
        "searchPrompts",
        { query: "[" },
      ),
    ).resolves.toEqual({ results: [] });
    await expect(
      callTool(context.client, "convertPrompt", {
        id: missingId,
        to: "json",
      }),
    ).rejects.toThrow(missingId);

    const missingExport = await callTool<{
      path: null;
      success: false;
      error: string;
    }>(context.client, "exportPrompt", {
      id: missingId,
      path: join(context.directory, "missing.md"),
    });
    expect(missingExport).toMatchObject({
      path: null,
      success: false,
      error: expect.stringContaining(missingId),
    });
    const missingOpen = await callTool<{
      success: false;
      error: string;
    }>(context.client, "openInVSCode", { id: missingId });
    expect(missingOpen).toMatchObject({
      success: false,
      error: expect.stringContaining(missingId),
    });
    const missingDelete = await callTool<{
      success: false;
      error: string;
    }>(context.client, "deletePrompt", { id: missingId });
    expect(missingDelete).toMatchObject({
      success: false,
      error: expect.stringContaining(missingId),
    });
    const missingRestore = await callTool<{
      success: false;
      error: string;
    }>(context.client, "restoreTrash", { id: missingId });
    expect(missingRestore).toMatchObject({
      success: false,
      error: expect.stringContaining(missingId),
    });
    expect(
      await callTool(context.client, "restoreLatestTrash"),
    ).toEqual({
      success: false,
      error: "No deleted prompts found",
    });

    context.failCommands = true;
    expect(
      await callTool(context.client, "openInVSCode", {
        id: created.prompt.id,
      }),
    ).toEqual({
      success: false,
      error: "editor unavailable",
    });

    const listed = await callTool<{ total: number }>(
      context.client,
      "listPrompts",
    );
    expect(listed.total).toBe(1);
  });

  it("closes client, transport, observability, and database resources idempotently", async () => {
    await context.client.close();
    await expect(context.server.close()).resolves.toBeUndefined();
    await expect(context.server.close()).resolves.toBeUndefined();
    expect(context.databasePath).not.toBe("");
  });
});

describe("PromptVaultMCPServer manifest failures", () => {
  it("propagates a missing manifest error and still closes cleanly", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pv-mcp-manifest-"));
    await rm(directory, { recursive: true, force: true });
    const context = await createContext({
      manifestPath: join(directory, "missing-mcp.json"),
    });

    await expect(context.client.listTools()).rejects.toThrow(
      "missing-mcp.json",
    );
    await context.client.close();
    await expect(context.server.close()).resolves.toBeUndefined();
  });
});
