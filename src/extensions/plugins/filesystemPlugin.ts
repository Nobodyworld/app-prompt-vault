import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  PromptVaultConnector,
  PromptVaultPlugin,
  PromptVaultPluginContext,
} from "../types.js";

interface FilesystemConnectorOptions {
  readonly baseDir: string;
  readonly createIfMissing?: boolean;
}

class FilesystemConnector implements PromptVaultConnector {
  public readonly name: string;
  public readonly type = "filesystem";
  private readonly baseDir: string;
  private readonly createIfMissing: boolean;
  private context?: PromptVaultPluginContext;

  public constructor(options: FilesystemConnectorOptions) {
    this.name = `filesystem-${options.baseDir}`;
    this.baseDir = resolve(options.baseDir);
    this.createIfMissing = options.createIfMissing ?? true;
  }

  public setup(context: PromptVaultPluginContext): void {
    this.context = context;
    context.logger.info("filesystem_connector_setup", {
      connector: this.name,
      baseDir: this.baseDir,
    });
  }

  public async connect(): Promise<void> {
    if (this.createIfMissing && !existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
      this.context?.logger.info("filesystem_connector_directory_created", {
        connector: this.name,
        baseDir: this.baseDir,
      });
    }

    if (!existsSync(this.baseDir)) {
      throw new Error(
        `Filesystem connector directory does not exist: ${this.baseDir}`,
      );
    }

    this.context?.logger.info("filesystem_connector_connected", {
      connector: this.name,
      baseDir: this.baseDir,
    });
  }

  public async disconnect(): Promise<void> {
    // Filesystem connectors don't need explicit disconnection
    this.context?.logger.info("filesystem_connector_disconnected", {
      connector: this.name,
    });
  }

  public writeFile(filename: string, content: string): void {
    const filePath = join(this.baseDir, filename);
    writeFileSync(filePath, content, "utf8");
    this.context?.logger.info("filesystem_connector_file_written", {
      connector: this.name,
      filePath,
    });
  }

  public readFile(filename: string): string {
    const filePath = join(this.baseDir, filename);
    const content = readFileSync(filePath, "utf8");
    this.context?.logger.info("filesystem_connector_file_read", {
      connector: this.name,
      filePath,
    });
    return content;
  }

  public fileExists(filename: string): boolean {
    const filePath = join(this.baseDir, filename);
    return existsSync(filePath);
  }
}

export function createFilesystemPlugin(
  options: FilesystemConnectorOptions,
): PromptVaultPlugin {
  const connector = new FilesystemConnector(options);

  return {
    name: "filesystem-connector",
    version: "1.0.0",
    description: "Provides filesystem operations for prompt vault",
    connectors: [connector],
    setup(context) {
      context.logger.info("filesystem_plugin_ready");
      context.telemetry.recordEvent("plugin.filesystem-connector.setup");
    },
  };
}

// Export the connector class for advanced usage
export { FilesystemConnector };
export type { FilesystemConnectorOptions };
