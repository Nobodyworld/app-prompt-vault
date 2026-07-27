import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginHost } from "../src/extensions/PluginHost.js";
import { PluginLoader } from "../src/extensions/PluginLoader.js";
import {
  FilesystemConnector,
  createFilesystemPlugin,
} from "../src/extensions/plugins/filesystemPlugin.js";
import { createAuditTrailPlugin } from "../src/extensions/plugins/auditTrailPlugin.js";
import { createOperationalTelemetryPlugin } from "../src/extensions/plugins/operationalTelemetryPlugin.js";
import type {
  PluginMetadata,
  PromptVaultPlugin,
} from "../src/extensions/types.js";
import type {
  Prompt,
  PromptVersion,
  Tag,
} from "../src/domain/models.js";
import { StructuredLogger } from "../src/observability/logger.js";
import {
  createNoopTelemetry,
  createTelemetry,
} from "../src/observability/telemetry.js";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function createLogger(): StructuredLogger {
  return new StructuredLogger({ level: "error" });
}

function createRecords(): {
  prompt: Prompt;
  version: PromptVersion;
  tag: Tag;
} {
  const timestamp = new Date("2026-02-03T04:05:06.000Z");
  const version: PromptVersion = {
    id: "version-1",
    promptId: "prompt-1",
    semanticVersion: "1.0.0",
    body: "Body",
    format: "markdown",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const tag: Tag = {
    id: "tag-1",
    label: "testing",
    createdAt: timestamp,
  };
  return {
    prompt: {
      id: "prompt-1",
      slug: "plugin-prompt",
      title: "Plugin Prompt",
      createdAt: timestamp,
      updatedAt: timestamp,
      tags: [tag],
      latestVersion: version,
    },
    version,
    tag,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("PluginHost lifecycle", () => {
  it("registers plugins and connectors and isolates connector failures", async () => {
    const logger = createLogger();
    const info = vi.spyOn(logger, "info");
    const warn = vi.spyOn(logger, "warn");
    const error = vi.spyOn(logger, "error");
    const telemetry = createNoopTelemetry();
    const setup = vi.fn();
    const connectOk = vi.fn(async () => undefined);
    const connectFail = vi.fn(async () => {
      throw new Error("connect failed");
    });
    const disconnectOk = vi.fn(async () => undefined);
    const disconnectFail = vi.fn(async () => {
      throw "disconnect failed";
    });
    const host = new PluginHost({ logger, telemetry });
    const plugin: PromptVaultPlugin = {
      name: "connectors",
      version: "2.3.4",
      description: "connector lifecycle",
      setup,
      connectors: [
        {
          name: "working",
          type: "test",
          setup: vi.fn(),
          connect: connectOk,
          disconnect: disconnectOk,
        },
        {
          name: "failing",
          type: "test",
          connect: connectFail,
          disconnect: disconnectFail,
        },
        {
          name: "passive",
          type: "test",
        },
      ],
    };

    host.register(plugin);
    await host.connectAll();
    await host.disconnectAll();

    expect(setup).toHaveBeenCalledWith({ logger, telemetry });
    expect(host.getPlugins()).toEqual([plugin]);
    expect(host.getConnectors()).toHaveLength(3);
    expect(host.getPluginMetadata()).toEqual([
      {
        name: "connectors",
        version: "2.3.4",
        description: "connector lifecycle",
        path: "",
        enabled: true,
      },
    ]);
    expect(connectOk).toHaveBeenCalledOnce();
    expect(connectFail).toHaveBeenCalledOnce();
    expect(disconnectOk).toHaveBeenCalledOnce();
    expect(disconnectFail).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith(
      "connector_connected",
      expect.objectContaining({ connector: "working" }),
    );
    expect(error).toHaveBeenCalledWith(
      "connector_connection_failed",
      expect.objectContaining({ error: "connect failed" }),
    );
    expect(warn).toHaveBeenCalledWith(
      "connector_disconnection_failed",
      expect.objectContaining({ error: "disconnect failed" }),
    );
  });

  it("emits every supported hook and keeps later plugins running after a hook fails", () => {
    const logger = createLogger();
    const warn = vi.spyOn(logger, "warn");
    const telemetry = createTelemetry({ serviceName: "plugin-hooks", logger });
    const records = createRecords();
    const handlers = {
      onPromptCreated: vi.fn(),
      onPromptUpdated: vi.fn(),
      onPromptDeleted: vi.fn(),
      onVersionAdded: vi.fn(),
      onPromptTagged: vi.fn(),
      onPromptUntagged: vi.fn(),
    };
    const host = new PluginHost({ logger, telemetry });
    host.register({
      name: "throwing",
      onPromptCreated() {
        throw new Error("hook failed");
      },
    });
    host.register({ name: "observer", ...handlers });

    host.emit("onPromptCreated", {
      prompt: records.prompt,
      version: records.version,
      actor: { userId: "user-1", requestId: "request-1" },
    });
    host.emit("onPromptUpdated", {
      prompt: records.prompt,
      updatedFields: ["title"],
    });
    host.emit("onPromptDeleted", {
      promptId: records.prompt.id,
      mode: "soft",
    });
    host.emit("onVersionAdded", {
      promptId: records.prompt.id,
      version: records.version,
    });
    host.emit("onPromptTagged", {
      promptId: records.prompt.id,
      tags: [records.tag],
    });
    host.emit("onPromptUntagged", {
      promptId: records.prompt.id,
      labels: [records.tag.label],
    });

    for (const handler of Object.values(handlers)) {
      expect(handler).toHaveBeenCalledOnce();
    }
    expect(warn).toHaveBeenCalledWith(
      "plugin_handler_failed",
      expect.objectContaining({
        plugin: "throwing",
        event: "onPromptCreated",
        error: "hook failed",
      }),
    );
    expect(telemetry.registry.snapshot()).toContain(
      'span_name="plugin.observer.onPromptCreated"',
    );
  });
});

describe("PluginLoader", () => {
  it("discovers supported extensions across valid and missing directories", async () => {
    const directory = await createTemporaryDirectory("pv-plugin-loader-");
    await writeFile(join(directory, "alpha.mjs"), "export default () => ({ name: 'alpha' });");
    await writeFile(join(directory, "beta.ts"), "export default () => ({ name: 'beta' });");
    await writeFile(join(directory, "ignored.txt"), "not a plugin");
    const logger = createLogger();
    const warn = vi.spyOn(logger, "warn");
    const loader = new PluginLoader({
      pluginDirs: [directory, join(directory, "missing")],
      logger,
    });

    const discovered = loader.discoverPlugins();

    expect(discovered.map((plugin) => plugin.name).sort()).toEqual([
      "alpha",
      "beta",
    ]);
    expect(discovered.every((plugin) => plugin.enabled)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      "plugin_directory_not_found",
      expect.objectContaining({ dir: expect.stringContaining("missing") }),
    );
  });

  it("loads default and named factories and rejects missing, invalid, and broken modules", async () => {
    const directory = await createTemporaryDirectory("pv-plugin-load-");
    const defaultPath = join(directory, "default-plugin.mjs");
    const namedPath = join(directory, "named-plugin.mjs");
    const missingFactoryPath = join(directory, "missing-factory.mjs");
    const invalidPath = join(directory, "invalid-plugin.mjs");
    const throwingPath = join(directory, "throwing-plugin.mjs");
    await writeFile(defaultPath, "export default () => ({ name: 'default-loaded' });");
    await writeFile(namedPath, "export const createPlugin = () => ({ name: 'named-loaded', version: '9.0.0' });");
    await writeFile(missingFactoryPath, "export const value = 1;");
    await writeFile(invalidPath, "export default () => ({ name: '' });");
    await writeFile(throwingPath, "throw new Error('module exploded');");
    const logger = createLogger();
    const error = vi.spyOn(logger, "error");
    const loader = new PluginLoader({ pluginDirs: [directory], logger });
    const metadata = (name: string, path: string): PluginMetadata => ({
      name,
      version: "1.0.0",
      path,
      enabled: true,
    });

    await expect(
      loader.loadPlugin(metadata("default", defaultPath)),
    ).resolves.toMatchObject({ name: "default-loaded" });
    await expect(
      loader.loadPlugin(metadata("named", namedPath)),
    ).resolves.toMatchObject({ name: "named-loaded", version: "9.0.0" });
    await expect(
      loader.loadPlugin(metadata("missing", missingFactoryPath)),
    ).resolves.toBeNull();
    await expect(
      loader.loadPlugin(metadata("invalid", invalidPath)),
    ).resolves.toBeNull();
    await expect(
      loader.loadPlugin(metadata("throwing", throwingPath)),
    ).resolves.toBeNull();
    await expect(
      loader.loadPlugin(metadata("absent", join(directory, "absent.mjs"))),
    ).resolves.toBeNull();

    expect(error).toHaveBeenCalledWith(
      "plugin_missing_factory",
      expect.objectContaining({ name: "missing" }),
    );
    expect(error).toHaveBeenCalledWith(
      "plugin_invalid_structure",
      expect.objectContaining({ name: "invalid" }),
    );
    expect(error).toHaveBeenCalledWith(
      "plugin_load_failed",
      expect.objectContaining({ name: "throwing", error: "module exploded" }),
    );
  });
});

describe("built-in plugins", () => {
  it("creates, connects, reads, writes, and disconnects a filesystem connector", async () => {
    const root = await createTemporaryDirectory("pv-filesystem-plugin-");
    const baseDir = join(root, "nested");
    const logger = createLogger();
    const telemetry = createNoopTelemetry();
    const connector = new FilesystemConnector({ baseDir });
    connector.setup({ logger, telemetry });

    await connector.connect();
    connector.writeFile("prompt.md", "filesystem body");
    expect(connector.fileExists("prompt.md")).toBe(true);
    expect(connector.fileExists("missing.md")).toBe(false);
    expect(connector.readFile("prompt.md")).toBe("filesystem body");
    await connector.disconnect();

    const plugin = createFilesystemPlugin({ baseDir });
    const host = new PluginHost({ logger, telemetry });
    host.register(plugin);
    expect(host.getConnectors()).toHaveLength(1);
    await host.connectAll();
    await host.disconnectAll();
  });

  it("fails closed when a filesystem connector cannot create its directory", async () => {
    const root = await createTemporaryDirectory("pv-filesystem-missing-");
    const connector = new FilesystemConnector({
      baseDir: join(root, "absent"),
      createIfMissing: false,
    });
    await expect(connector.connect()).rejects.toThrow(
      "Filesystem connector directory does not exist",
    );
  });

  it("records audit hooks and operational write metrics", () => {
    const logger = createLogger();
    const info = vi.spyOn(logger, "info");
    const telemetry = createTelemetry({
      serviceName: "built-in-plugins",
      logger,
    });
    const records = createRecords();
    const host = new PluginHost({ logger, telemetry });
    host.register(createAuditTrailPlugin());
    host.register(createOperationalTelemetryPlugin());

    host.emit("onPromptCreated", {
      prompt: records.prompt,
      version: records.version,
      actor: { userId: "user-2", requestId: "request-2" },
    });
    host.emit("onPromptUpdated", {
      prompt: records.prompt,
      updatedFields: ["title", "description"],
    });
    host.emit("onPromptDeleted", {
      promptId: records.prompt.id,
      mode: "permanent",
    });
    host.emit("onVersionAdded", {
      promptId: records.prompt.id,
      version: records.version,
    });
    host.emit("onPromptTagged", {
      promptId: records.prompt.id,
      tags: [records.tag],
    });
    host.emit("onPromptUntagged", {
      promptId: records.prompt.id,
      labels: [records.tag.label],
    });

    expect(info).toHaveBeenCalledWith(
      "audit_prompt_created",
      expect.objectContaining({
        promptId: "prompt-1",
        actorUserId: "user-2",
      }),
    );
    const snapshot = telemetry.registry.snapshot();
    expect(snapshot).toContain(
      'prompt_vault_prompt_writes_total{operation="create"} 1',
    );
    expect(snapshot).toContain(
      'prompt_vault_prompt_writes_total{operation="add-version"} 1',
    );
    expect(snapshot).toContain(
      'prompt_vault_prompt_writes_total{operation="tag"} 1',
    );
    expect(snapshot).toContain(
      'prompt_vault_prompt_writes_total{operation="untag"} 1',
    );
  });

  it("leaves operational hooks inert until setup supplies telemetry", () => {
    const plugin = createOperationalTelemetryPlugin();
    const records = createRecords();

    expect(() => {
      plugin.onPromptCreated?.({
        prompt: records.prompt,
        version: records.version,
      });
      plugin.onVersionAdded?.({
        promptId: records.prompt.id,
        version: records.version,
      });
      plugin.onPromptTagged?.({
        promptId: records.prompt.id,
        tags: [records.tag],
      });
      plugin.onPromptUntagged?.({
        promptId: records.prompt.id,
        labels: [records.tag.label],
      });
    }).not.toThrow();
  });
});
