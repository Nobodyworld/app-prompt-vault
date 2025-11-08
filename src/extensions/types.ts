import type { Prompt, PromptId, PromptVersion, Tag } from "../domain/models.js";
import type { StructuredLogger } from "../observability/logger.js";
import type { Telemetry } from "../observability/telemetry.js";

export interface PromptVaultPluginContext {
  readonly logger: StructuredLogger;
  readonly telemetry: Telemetry;
}

export interface PromptVaultConnector {
  readonly name: string;
  readonly type: string;
  setup?(context: PromptVaultPluginContext): void;
  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
}

export interface PromptVaultPlugin {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly connectors?: readonly PromptVaultConnector[];
  setup?(context: PromptVaultPluginContext): void;
  onPromptCreated?(payload: { prompt: Prompt; version: PromptVersion }): void;
  onVersionAdded?(payload: { promptId: PromptId; version: PromptVersion }): void;
  onPromptTagged?(payload: { promptId: PromptId; tags: readonly Tag[] }): void;
  onPromptUntagged?(payload: { promptId: PromptId; labels: readonly string[] }): void;
}

export interface PluginMetadata {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly path: string;
  readonly enabled: boolean;
}
