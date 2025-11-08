import { readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { PromptVaultPlugin, PluginMetadata } from "./types.js";
import type { StructuredLogger } from "../observability/logger.js";

export interface PluginDiscoveryOptions {
  readonly pluginDirs: readonly string[];
  readonly logger: StructuredLogger;
}

export class PluginLoader {
  private readonly options: PluginDiscoveryOptions;

  public constructor(options: PluginDiscoveryOptions) {
    this.options = options;
  }

  public discoverPlugins(): PluginMetadata[] {
    const plugins: PluginMetadata[] = [];

    for (const dir of this.options.pluginDirs) {
      try {
        const absoluteDir = resolve(dir);
        this.options.logger.info("scanning_plugin_directory", { dir: absoluteDir });

        if (!this.isDirectory(absoluteDir)) {
          this.options.logger.warn("plugin_directory_not_found", { dir: absoluteDir });
          continue;
        }

        const files = readdirSync(absoluteDir);
        for (const file of files) {
          if (this.isPluginFile(file)) {
            const pluginPath = join(absoluteDir, file);
            const metadata = this.extractPluginMetadata(pluginPath);
            if (metadata) {
              plugins.push(metadata);
            }
          }
        }
      } catch (error) {
        this.options.logger.warn("plugin_directory_scan_failed", {
          dir,
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    return plugins;
  }

  public async loadPlugin(metadata: PluginMetadata): Promise<PromptVaultPlugin | null> {
    try {
      this.options.logger.info("loading_plugin", { name: metadata.name, path: metadata.path });

      // Convert Windows paths to file:// URLs for ESM compatibility
      let importPath = metadata.path;
      if (process.platform === 'win32' && !importPath.startsWith('file://')) {
        importPath = `file:///${importPath.replace(/\\/g, '/')}`;
      }

      // Dynamic import of the plugin
      const module = await import(importPath);
      const createPlugin = module.default || module.createPlugin;

      if (typeof createPlugin !== "function") {
        this.options.logger.error("plugin_missing_factory", {
          name: metadata.name,
          path: metadata.path,
          exports: Object.keys(module),
        });
        return null;
      }

      const plugin = createPlugin();
      if (!this.isValidPlugin(plugin)) {
        this.options.logger.error("plugin_invalid_structure", {
          name: metadata.name,
          path: metadata.path,
        });
        return null;
      }

      this.options.logger.info("plugin_loaded_successfully", {
        name: plugin.name,
        version: plugin.version ?? "1.0.0",
      });

      return plugin;
    } catch (error) {
      this.options.logger.error("plugin_load_failed", {
        name: metadata.name,
        path: metadata.path,
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  }

  private isDirectory(path: string): boolean {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  }

  private isPluginFile(filename: string): boolean {
    const ext = extname(filename);
    return ext === ".js" || ext === ".ts" || ext === ".mjs" || ext === ".mts";
  }

  private extractPluginMetadata(pluginPath: string): PluginMetadata | null {
    try {
      // For now, we'll extract basic metadata from the file path
      // In a more advanced implementation, we could read package.json or plugin metadata
      const filename = pluginPath.split(/[/\\]/).pop() ?? "";
      const name = filename.replace(/\.(js|ts|mjs|mts)$/, "");

      return {
        name,
        version: "1.0.0", // Default version
        path: pluginPath,
        enabled: true,
      };
    } catch (error) {
      this.options.logger.warn("plugin_metadata_extraction_failed", {
        path: pluginPath,
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  }

  private isValidPlugin(plugin: unknown): plugin is PromptVaultPlugin {
    if (!plugin || typeof plugin !== "object") {
      return false;
    }

    const candidate = plugin as Record<string, unknown>;
    return typeof candidate.name === "string" && candidate.name.length > 0;
  }
}
